import { and, asc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/server/db";
import {
  barcodes,
  brands,
  categories,
  products,
  productVariants,
  stockBalances,
  taxProfiles,
  unitsOfMeasure,
  warehouses,
} from "@/server/db/schema";
import { recordAudit } from "@/server/audit";
import { hasPermission, requirePermission } from "@/server/authz/guard";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { requireCompany, type ServiceContext } from "@/server/service-context";
import { parseOrThrow } from "@/server/validation";
import { parseMoney } from "@/lib/money";
import { postMovement } from "@/server/modules/inventory/ledger";
import { allowsNegative, getDefaultWarehouse, variantLabel } from "@/server/modules/inventory/service";

export { DEFAULT_UNITS, ensureCatalogDefaults } from "./defaults";
import { ensureCatalogDefaults } from "./defaults";

// ---------------------------------------------------------------- Listas auxiliares

export async function listCatalogOptions(ctx: ServiceContext) {
  requirePermission(ctx, "catalog.view");
  const company = requireCompany(ctx);
  await ensureCatalogDefaults(db, ctx.tenantId, company.id, ctx.userId);
  const [cats, brs, units, taxes] = await Promise.all([
    db.select({ id: categories.id, name: categories.name, color: categories.color }).from(categories).where(and(eq(categories.companyId, company.id), isNull(categories.deactivatedAt))).orderBy(asc(categories.sortOrder), asc(categories.name)),
    db.select({ id: brands.id, name: brands.name }).from(brands).where(and(eq(brands.companyId, company.id), isNull(brands.deactivatedAt))).orderBy(asc(brands.name)),
    db.select().from(unitsOfMeasure).where(and(eq(unitsOfMeasure.companyId, company.id), isNull(unitsOfMeasure.deactivatedAt))).orderBy(asc(unitsOfMeasure.name)),
    db.select().from(taxProfiles).where(and(eq(taxProfiles.companyId, company.id), isNull(taxProfiles.deactivatedAt))).orderBy(asc(taxProfiles.code)),
  ]);
  return { categories: cats, brands: brs, units, taxes };
}

async function findOrCreateCategory(tx: DbOrTx, ctx: ServiceContext, companyId: string, name: string | undefined | null) {
  const clean = name?.trim();
  if (!clean) return null;
  const [found] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.companyId, companyId), isNull(categories.parentId), sql`lower(${categories.name}) = lower(${clean})`))
    .limit(1);
  if (found) return found.id;
  const [created] = await tx
    .insert(categories)
    .values({ tenantId: ctx.tenantId, companyId, name: clean, createdBy: ctx.userId, updatedBy: ctx.userId })
    .returning({ id: categories.id });
  return created.id;
}

async function findOrCreateBrand(tx: DbOrTx, ctx: ServiceContext, companyId: string, name: string | undefined | null) {
  const clean = name?.trim();
  if (!clean) return null;
  const [found] = await tx
    .select({ id: brands.id })
    .from(brands)
    .where(and(eq(brands.companyId, companyId), sql`lower(${brands.name}) = lower(${clean})`))
    .limit(1);
  if (found) return found.id;
  const [created] = await tx
    .insert(brands)
    .values({ tenantId: ctx.tenantId, companyId, name: clean, createdBy: ctx.userId, updatedBy: ctx.userId })
    .returning({ id: brands.id });
  return created.id;
}

// ---------------------------------------------------------------- Validación

const skuSchema = z
  .string()
  .trim()
  .min(1, "Obligatorio")
  .max(40, "Máximo 40 caracteres")
  .regex(/^[A-Za-z0-9._\-/]+$/, "Solo letras, números, punto, guion, guion bajo y diagonal");

const barcodeSchema = z
  .string()
  .trim()
  .min(3, "Código demasiado corto")
  .max(48, "Código demasiado largo")
  .regex(/^[A-Za-z0-9\-.]+$/, "Solo letras, números, guion y punto");

const moneyInput = z.union([z.string(), z.number()]).transform((v, c) => {
  const cents = parseMoney(v);
  if (cents === null || cents < 0) {
    c.addIssue({ code: "custom", message: "Importe inválido" });
    return z.NEVER;
  }
  return cents;
});
const optionalMoney = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v, c) => {
    if (v === undefined || v === null || v === "") return null;
    const cents = parseMoney(v);
    if (cents === null || cents < 0) {
      c.addIssue({ code: "custom", message: "Importe inválido" });
      return z.NEVER;
    }
    return cents;
  });
const optionalQty = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v, c) => {
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) {
      c.addIssue({ code: "custom", message: "Cantidad inválida" });
      return z.NEVER;
    }
    return Math.round(n * 1000) / 1000;
  });

export const variantInputSchema = z.object({
  id: z.string().uuid().optional(),
  sku: skuSchema,
  attributeValues: z.record(z.string(), z.string().trim().max(40)).default({}),
  price: moneyInput,
  cost: optionalMoney,
  barcodes: z.array(barcodeSchema).max(10, "Máximo 10 códigos por variante").default([]),
  initialStock: optionalQty,
  minStock: optionalQty,
  reorderPoint: optionalQty,
});
export type VariantInput = z.infer<typeof variantInputSchema>;

export const productSchema = z.object({
  name: z.string().trim().min(2, "Mínimo 2 caracteres").max(160, "Máximo 160 caracteres"),
  sku: skuSchema,
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  kind: z.enum(["simple", "variable"]),
  categoryName: z.string().trim().max(60).optional().or(z.literal("")),
  brandName: z.string().trim().max(60).optional().or(z.literal("")),
  unitId: z.string().uuid("Elige una unidad"),
  taxProfileId: z.string().uuid("Elige un impuesto"),
  trackStock: z.boolean().default(true),
  isFavorite: z.boolean().default(false),
  satProductCode: z.string().trim().max(10).optional().or(z.literal("")),
  attributeNames: z.array(z.string().trim().min(1).max(30)).max(3, "Máximo 3 atributos").default([]),
  variants: z.array(variantInputSchema).min(1, "Agrega al menos una variante").max(200, "Máximo 200 variantes"),
});
export type ProductInput = z.infer<typeof productSchema>;

export const productUpdateSchema = productSchema.omit({ kind: true, variants: true, attributeNames: true, sku: true });

function variantNameOf(attributeNames: string[], values: Record<string, string>) {
  return attributeNames.map((n) => values[n]).filter(Boolean).join(" / ");
}

/** Reglas que zod no cubre: duplicados dentro del formulario y atributos completos. */
function validateVariantSet(input: Pick<ProductInput, "kind" | "attributeNames" | "variants">) {
  const errors: Record<string, string[]> = {};
  if (input.kind === "simple" && input.variants.length !== 1) errors.variants = ["Un producto simple tiene exactamente una variante."];
  if (input.kind === "variable" && input.attributeNames.length === 0) errors.attributeNames = ["Define al menos un atributo (p. ej. Talla)."];
  const skus = new Set<string>();
  const codes = new Set<string>();
  const combos = new Set<string>();
  input.variants.forEach((v, i) => {
    const sku = v.sku.toLowerCase();
    if (skus.has(sku)) (errors[`variants.${i}.sku`] ??= []).push("SKU repetido.");
    skus.add(sku);
    for (const c of v.barcodes) {
      if (codes.has(c)) (errors[`variants.${i}.barcodes`] ??= []).push(`Código ${c} repetido.`);
      codes.add(c);
    }
    if (input.kind === "variable") {
      const missing = input.attributeNames.filter((n) => !v.attributeValues[n]);
      if (missing.length) (errors[`variants.${i}.attributeValues`] ??= []).push(`Falta: ${missing.join(", ")}.`);
      const key = input.attributeNames.map((n) => (v.attributeValues[n] ?? "").toLowerCase()).join("|");
      if (combos.has(key)) (errors[`variants.${i}.attributeValues`] ??= []).push("Combinación repetida.");
      combos.add(key);
    }
  });
  if (Object.keys(errors).length) throw new ValidationError(errors);
}

async function assertCodesAvailable(conn: DbOrTx, companyId: string, skus: string[], codes: string[], exceptVariantIds: string[] = []) {
  const errors: string[] = [];
  if (skus.length) {
    const taken = await conn
      .select({ sku: productVariants.sku, id: productVariants.id })
      .from(productVariants)
      .where(and(eq(productVariants.companyId, companyId), inArray(sql`lower(${productVariants.sku})`, skus.map((s) => s.toLowerCase()))));
    for (const t of taken) if (!exceptVariantIds.includes(t.id)) errors.push(`El SKU ${t.sku} ya existe.`);
  }
  if (codes.length) {
    const taken = await conn
      .select({ code: barcodes.code, variantId: barcodes.variantId })
      .from(barcodes)
      .where(and(eq(barcodes.companyId, companyId), inArray(barcodes.code, codes)));
    for (const t of taken) if (!exceptVariantIds.includes(t.variantId)) errors.push(`El código de barras ${t.code} ya está asignado a otro producto.`);
  }
  if (errors.length) throw new ValidationError({ _: errors }, errors[0]);
}

async function assertCompanyRefs(conn: DbOrTx, companyId: string, unitId: string, taxProfileId: string) {
  const [u] = await conn.select({ id: unitsOfMeasure.id }).from(unitsOfMeasure).where(and(eq(unitsOfMeasure.id, unitId), eq(unitsOfMeasure.companyId, companyId))).limit(1);
  if (!u) throw new ValidationError({ unitId: ["Unidad no válida."] });
  const [t] = await conn.select({ id: taxProfiles.id }).from(taxProfiles).where(and(eq(taxProfiles.id, taxProfileId), eq(taxProfiles.companyId, companyId))).limit(1);
  if (!t) throw new ValidationError({ taxProfileId: ["Impuesto no válido."] });
}

// ---------------------------------------------------------------- Alta

export async function createProduct(ctx: ServiceContext, raw: unknown) {
  requirePermission(ctx, "catalog.create");
  const company = requireCompany(ctx);
  const input = parseOrThrow(productSchema, raw);
  if (input.kind === "simple") {
    input.attributeNames = [];
    input.variants = [{ ...input.variants[0], sku: input.variants[0].sku || input.sku, attributeValues: {} }];
  }
  validateVariantSet(input);

  const anyCost = input.variants.some((v) => v.cost !== null);
  if (anyCost && !hasPermission(ctx, "catalog.view_cost")) throw new ForbiddenError("catalog.view_cost", "No tienes permiso para capturar costos.");
  const anyStock = input.variants.some((v) => (v.initialStock ?? 0) > 0);
  if (anyStock && !input.trackStock) throw new ValidationError({ trackStock: ["Activa el control de inventario para capturar existencia inicial."] });
  if (anyStock) requirePermission(ctx, "inventory.adjust");

  const allSkus = [input.sku, ...input.variants.map((v) => v.sku)];
  await assertCodesAvailable(db, company.id, [...new Set(allSkus.map((s) => s.toLowerCase()))], input.variants.flatMap((v) => v.barcodes));
  await assertCompanyRefs(db, company.id, input.unitId, input.taxProfileId);
  const [productSkuTaken] = await db.select({ id: products.id }).from(products).where(and(eq(products.companyId, company.id), sql`lower(${products.sku}) = lower(${input.sku})`)).limit(1);
  if (productSkuTaken) throw new ValidationError({ sku: ["Ese SKU de producto ya existe."] });

  let warehouse: typeof warehouses.$inferSelect | null = null;
  if (anyStock) {
    if (!ctx.branch) throw new ConflictError("Selecciona una sucursal activa para registrar la existencia inicial.");
    warehouse = await getDefaultWarehouse(db, ctx.branch.id);
  }

  return db.transaction(async (tx) => {
    const categoryId = await findOrCreateCategory(tx, ctx, company.id, input.categoryName);
    const brandId = await findOrCreateBrand(tx, ctx, company.id, input.brandName);
    const [product] = await tx
      .insert(products)
      .values({
        tenantId: ctx.tenantId,
        companyId: company.id,
        sku: input.sku,
        name: input.name,
        description: input.description || null,
        kind: input.kind,
        categoryId,
        brandId,
        unitId: input.unitId,
        taxProfileId: input.taxProfileId,
        attributeNames: input.attributeNames,
        trackStock: input.trackStock,
        isFavorite: input.isFavorite,
        satProductCode: input.satProductCode || null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();

    const created: Array<typeof productVariants.$inferSelect> = [];
    for (const [i, v] of input.variants.entries()) {
      const [variant] = await tx
        .insert(productVariants)
        .values({
          tenantId: ctx.tenantId,
          companyId: company.id,
          productId: product.id,
          sku: v.sku,
          variantName: variantNameOf(input.attributeNames, v.attributeValues),
          attributeValues: input.kind === "variable" ? v.attributeValues : {},
          price: v.price,
          cost: v.cost,
          minStock: v.minStock === null ? null : String(v.minStock),
          reorderPoint: v.reorderPoint === null ? null : String(v.reorderPoint),
          isDefault: i === 0,
          sortOrder: i,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning();
      created.push(variant);
      if (v.barcodes.length) {
        await tx.insert(barcodes).values(v.barcodes.map((code) => ({ tenantId: ctx.tenantId, companyId: company.id, variantId: variant.id, code, createdBy: ctx.userId, updatedBy: ctx.userId })));
      }
      if (warehouse && (v.initialStock ?? 0) > 0) {
        await postMovement(tx, {
          tenantId: ctx.tenantId,
          companyId: company.id,
          branchId: warehouse.branchId,
          warehouseId: warehouse.id,
          variantId: variant.id,
          movementType: "opening",
          quantity: v.initialStock!,
          unitCost: v.cost,
          allowNegative: true,
          referenceType: "product",
          referenceId: product.id,
          reason: "Existencia inicial al dar de alta el producto",
          createdBy: ctx.userId,
        });
      }
    }

    await recordAudit(tx, ctx.actor, {
      action: "catalog.create",
      entity: "product",
      entityId: product.id,
      after: {
        sku: product.sku,
        name: product.name,
        kind: product.kind,
        variants: created.map((v) => ({ sku: v.sku, variant: v.variantName, price: v.price, cost: v.cost })),
        initialStock: warehouse ? input.variants.map((v) => ({ sku: v.sku, qty: v.initialStock ?? 0 })) : undefined,
      },
    });
    return { product, variants: created };
  });
}

// ---------------------------------------------------------------- Consulta

export type ProductListItem = {
  id: string;
  sku: string;
  name: string;
  kind: "simple" | "variable";
  categoryName: string | null;
  brandName: string | null;
  isFavorite: boolean;
  trackStock: boolean;
  active: boolean;
  variantCount: number;
  minPrice: number;
  maxPrice: number;
  missingCost: boolean;
  stock: number | null;
};

export async function listProducts(
  ctx: ServiceContext,
  opts: { q?: string | null; categoryId?: string | null; includeInactive?: boolean; limit?: number; offset?: number } = {},
): Promise<{ items: ProductListItem[]; hasMore: boolean }> {
  requirePermission(ctx, "catalog.view");
  const company = requireCompany(ctx);
  const where: SQL[] = [eq(products.companyId, company.id)];
  if (!opts.includeInactive) where.push(isNull(products.deactivatedAt));
  if (opts.categoryId) where.push(eq(products.categoryId, opts.categoryId));
  if (opts.q?.trim()) {
    const term = opts.q.trim();
    const like = `%${term}%`;
    where.push(
      or(
        ilike(products.name, like),
        ilike(products.sku, like),
        sql`exists (select 1 from ${productVariants} pv where pv.product_id = ${products.id} and lower(pv.sku) like lower(${like}))`,
        sql`exists (select 1 from ${barcodes} b join ${productVariants} pv on pv.id = b.variant_id where pv.product_id = ${products.id} and b.code = ${term})`,
      )!,
    );
  }
  const limit = Math.min(opts.limit ?? 50, 200);
  let defaultWh: string | null = null;
  if (ctx.branch) {
    const [wh] = await db.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.branchId, ctx.branch.id), eq(warehouses.isDefault, true))).limit(1);
    defaultWh = wh?.id ?? null;
  }
  const rows = await db
    .select({
      p: products,
      categoryName: categories.name,
      brandName: brands.name,
      variantCount: sql<number>`count(${productVariants.id}) filter (where ${productVariants.deactivatedAt} is null)`.mapWith(Number),
      minPrice: sql<number>`coalesce(min(${productVariants.price}) filter (where ${productVariants.deactivatedAt} is null), 0)`.mapWith(Number),
      maxPrice: sql<number>`coalesce(max(${productVariants.price}) filter (where ${productVariants.deactivatedAt} is null), 0)`.mapWith(Number),
      missingCost: sql<boolean>`bool_or(${productVariants.cost} is null and ${productVariants.deactivatedAt} is null)`,
      stock: defaultWh
        ? sql<string | null>`(select sum(sb.on_hand) from ${stockBalances} sb join ${productVariants} pv2 on pv2.id = sb.variant_id where pv2.product_id = ${products.id} and sb.warehouse_id = ${defaultWh})`
        : sql<string | null>`null`,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .leftJoin(productVariants, eq(productVariants.productId, products.id))
    .where(and(...where))
    .groupBy(products.id, categories.name, brands.name)
    .orderBy(asc(products.name))
    .limit(limit + 1)
    .offset(opts.offset ?? 0);
  const items = rows.slice(0, limit).map((r) => ({
    id: r.p.id,
    sku: r.p.sku,
    name: r.p.name,
    kind: r.p.kind,
    categoryName: r.categoryName,
    brandName: r.brandName,
    isFavorite: r.p.isFavorite,
    trackStock: r.p.trackStock,
    active: !r.p.deactivatedAt,
    variantCount: r.variantCount,
    minPrice: r.minPrice,
    maxPrice: r.maxPrice,
    missingCost: !!r.missingCost,
    stock: r.p.trackStock && r.stock !== null ? Number(r.stock) : null,
  }));
  return { items, hasMore: rows.length > limit };
}

export async function getProduct(ctx: ServiceContext, productId: string) {
  requirePermission(ctx, "catalog.view");
  const company = requireCompany(ctx);
  const [row] = await db
    .select({ p: products, categoryName: categories.name, brandName: brands.name, unit: unitsOfMeasure, tax: taxProfiles })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .innerJoin(unitsOfMeasure, eq(unitsOfMeasure.id, products.unitId))
    .innerJoin(taxProfiles, eq(taxProfiles.id, products.taxProfileId))
    .where(and(eq(products.id, productId), eq(products.companyId, company.id)))
    .limit(1);
  if (!row) throw new NotFoundError("El producto");
  const variants = await db.select().from(productVariants).where(eq(productVariants.productId, productId)).orderBy(asc(productVariants.sortOrder), asc(productVariants.sku));
  const codes = variants.length
    ? await db.select().from(barcodes).where(inArray(barcodes.variantId, variants.map((v) => v.id))).orderBy(asc(barcodes.code))
    : [];
  const stock = variants.length
    ? await db
        .select({ variantId: stockBalances.variantId, warehouseId: stockBalances.warehouseId, onHand: stockBalances.onHand, avgCost: stockBalances.avgCost, warehouseCode: warehouses.code, warehouseName: warehouses.name, branchId: warehouses.branchId })
        .from(stockBalances)
        .innerJoin(warehouses, eq(warehouses.id, stockBalances.warehouseId))
        .where(inArray(stockBalances.variantId, variants.map((v) => v.id)))
    : [];
  const showCost = hasPermission(ctx, "catalog.view_cost");
  const canSeeAll = ctx.permissions.has("branches.manage");
  const visible = new Set(ctx.branches.map((b) => b.id));
  return {
    product: row.p,
    categoryName: row.categoryName,
    brandName: row.brandName,
    unit: row.unit,
    tax: row.tax,
    variants: variants.map((v) => ({
      ...v,
      cost: showCost ? v.cost : null,
      barcodes: codes.filter((c) => c.variantId === v.id).map((c) => c.code),
      stock: stock
        .filter((s) => s.variantId === v.id && (canSeeAll || visible.has(s.branchId)))
        .map((s) => ({ warehouseId: s.warehouseId, code: s.warehouseCode, name: s.warehouseName, onHand: Number(s.onHand), avgCost: showCost ? s.avgCost : null })),
    })),
  };
}

// ---------------------------------------------------------------- Edición

export async function updateProduct(ctx: ServiceContext, productId: string, raw: unknown) {
  requirePermission(ctx, "catalog.edit");
  const company = requireCompany(ctx);
  const input = parseOrThrow(productUpdateSchema, raw);
  const before = await getProduct(ctx, productId);
  await assertCompanyRefs(db, company.id, input.unitId, input.taxProfileId);
  return db.transaction(async (tx) => {
    const categoryId = await findOrCreateCategory(tx, ctx, company.id, input.categoryName);
    const brandId = await findOrCreateBrand(tx, ctx, company.id, input.brandName);
    const [after] = await tx
      .update(products)
      .set({
        name: input.name,
        description: input.description || null,
        categoryId,
        brandId,
        unitId: input.unitId,
        taxProfileId: input.taxProfileId,
        trackStock: input.trackStock,
        isFavorite: input.isFavorite,
        satProductCode: input.satProductCode || null,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(and(eq(products.id, productId), eq(products.companyId, company.id)))
      .returning();
    await recordAudit(tx, ctx.actor, {
      action: "catalog.edit",
      entity: "product",
      entityId: productId,
      before: { name: before.product.name, category: before.categoryName, brand: before.brandName, taxProfileId: before.product.taxProfileId, trackStock: before.product.trackStock, isFavorite: before.product.isFavorite },
      after: { name: after.name, category: input.categoryName || null, brand: input.brandName || null, taxProfileId: after.taxProfileId, trackStock: after.trackStock, isFavorite: after.isFavorite },
    });
    return after;
  });
}

export const variantUpdateSchema = variantInputSchema.omit({ id: true, initialStock: true, attributeValues: true }).extend({
  attributeValues: z.record(z.string(), z.string().trim().max(40)).optional(),
});

/**
 * Edita una variante: SKU, precio (requiere catalog.edit_price), costo
 * (requiere catalog.view_cost), códigos de barras, mínimos.
 */
export async function updateVariant(ctx: ServiceContext, variantId: string, raw: unknown) {
  requirePermission(ctx, "catalog.edit");
  const company = requireCompany(ctx);
  const input = parseOrThrow(variantUpdateSchema, raw);
  const [before] = await db
    .select({ v: productVariants, p: products })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(eq(productVariants.id, variantId), eq(productVariants.companyId, company.id)))
    .limit(1);
  if (!before) throw new NotFoundError("La variante");
  const canCost = hasPermission(ctx, "catalog.view_cost");
  if (input.price !== before.v.price) requirePermission(ctx, "catalog.edit_price");
  if (canCost === false && input.cost !== null && input.cost !== before.v.cost) throw new ForbiddenError("catalog.view_cost");
  const newCost = canCost ? input.cost : before.v.cost;
  const beforeCodes = (await db.select({ code: barcodes.code }).from(barcodes).where(eq(barcodes.variantId, variantId))).map((c) => c.code);
  const codes = [...new Set(input.barcodes)];
  await assertCodesAvailable(db, company.id, input.sku.toLowerCase() !== before.v.sku.toLowerCase() ? [input.sku] : [], codes, [variantId]);
  let attributeValues = before.v.attributeValues;
  let variantName = before.v.variantName;
  if (before.p.kind === "variable" && input.attributeValues) {
    const missing = before.p.attributeNames.filter((n) => !input.attributeValues![n]);
    if (missing.length) throw new ValidationError({ attributeValues: [`Falta: ${missing.join(", ")}.`] });
    attributeValues = Object.fromEntries(before.p.attributeNames.map((n) => [n, input.attributeValues![n]]));
    variantName = variantNameOf(before.p.attributeNames, attributeValues);
  }
  return db.transaction(async (tx) => {
    const [after] = await tx
      .update(productVariants)
      .set({
        sku: input.sku,
        price: input.price,
        cost: newCost,
        attributeValues,
        variantName,
        minStock: input.minStock === null ? null : String(input.minStock),
        reorderPoint: input.reorderPoint === null ? null : String(input.reorderPoint),
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(eq(productVariants.id, variantId))
      .returning();
    await tx.delete(barcodes).where(and(eq(barcodes.variantId, variantId), codes.length ? sql`${barcodes.code} not in (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})` : sql`true`));
    const toAdd = codes.filter((c) => !beforeCodes.includes(c));
    if (toAdd.length) await tx.insert(barcodes).values(toAdd.map((code) => ({ tenantId: ctx.tenantId, companyId: company.id, variantId, code, createdBy: ctx.userId, updatedBy: ctx.userId })));
    await recordAudit(tx, ctx.actor, {
      action: input.price !== before.v.price ? "catalog.edit_price" : "catalog.edit",
      entity: "product_variant",
      entityId: variantId,
      before: { sku: before.v.sku, variant: before.v.variantName, price: before.v.price, cost: canCost ? before.v.cost : undefined, barcodes: beforeCodes, minStock: before.v.minStock, reorderPoint: before.v.reorderPoint },
      after: { sku: after.sku, variant: after.variantName, price: after.price, cost: canCost ? after.cost : undefined, barcodes: codes, minStock: after.minStock, reorderPoint: after.reorderPoint },
    });
    return after;
  });
}

/** Agrega una variante a un producto con variantes. */
export async function addVariant(ctx: ServiceContext, productId: string, raw: unknown) {
  requirePermission(ctx, "catalog.edit");
  const company = requireCompany(ctx);
  const input = parseOrThrow(variantInputSchema, raw);
  const detail = await getProduct(ctx, productId);
  if (detail.product.kind !== "variable") throw new ConflictError("Solo los productos con variantes admiten variantes adicionales.");
  validateVariantSet({
    kind: "variable",
    attributeNames: detail.product.attributeNames,
    variants: [...detail.variants.map((v) => ({ sku: v.sku, attributeValues: v.attributeValues, barcodes: v.barcodes } as VariantInput)), input],
  });
  if (input.cost !== null) requirePermission(ctx, "catalog.view_cost");
  if ((input.initialStock ?? 0) > 0) requirePermission(ctx, "inventory.adjust");
  await assertCodesAvailable(db, company.id, [input.sku], input.barcodes);
  const warehouse = (input.initialStock ?? 0) > 0 && ctx.branch ? await getDefaultWarehouse(db, ctx.branch.id) : null;
  return db.transaction(async (tx) => {
    const [variant] = await tx
      .insert(productVariants)
      .values({
        tenantId: ctx.tenantId,
        companyId: company.id,
        productId,
        sku: input.sku,
        variantName: variantNameOf(detail.product.attributeNames, input.attributeValues),
        attributeValues: input.attributeValues,
        price: input.price,
        cost: input.cost,
        minStock: input.minStock === null ? null : String(input.minStock),
        reorderPoint: input.reorderPoint === null ? null : String(input.reorderPoint),
        sortOrder: detail.variants.length,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    if (input.barcodes.length) await tx.insert(barcodes).values(input.barcodes.map((code) => ({ tenantId: ctx.tenantId, companyId: company.id, variantId: variant.id, code, createdBy: ctx.userId, updatedBy: ctx.userId })));
    if (warehouse) {
      await postMovement(tx, {
        tenantId: ctx.tenantId,
        companyId: company.id,
        branchId: warehouse.branchId,
        warehouseId: warehouse.id,
        variantId: variant.id,
        movementType: "opening",
        quantity: input.initialStock!,
        unitCost: input.cost,
        allowNegative: allowsNegative(ctx, warehouse),
        referenceType: "product",
        referenceId: productId,
        reason: "Existencia inicial al agregar la variante",
        createdBy: ctx.userId,
        label: variantLabel(detail.product, variant),
      });
    }
    await recordAudit(tx, ctx.actor, {
      action: "catalog.create",
      entity: "product_variant",
      entityId: variant.id,
      after: { product: detail.product.sku, sku: variant.sku, variant: variant.variantName, price: variant.price, initialStock: input.initialStock ?? 0 },
    });
    return variant;
  });
}

export async function setProductActive(ctx: ServiceContext, productId: string, active: boolean, reason?: string) {
  requirePermission(ctx, "catalog.disable");
  const company = requireCompany(ctx);
  const detail = await getProduct(ctx, productId);
  return db.transaction(async (tx) => {
    const now = new Date();
    await tx
      .update(products)
      .set(active ? { deactivatedAt: null, deactivatedBy: null, updatedAt: now, updatedBy: ctx.userId } : { deactivatedAt: now, deactivatedBy: ctx.userId, updatedAt: now, updatedBy: ctx.userId })
      .where(and(eq(products.id, productId), eq(products.companyId, company.id)));
    await recordAudit(tx, ctx.actor, {
      action: active ? "catalog.activate" : "catalog.disable",
      entity: "product",
      entityId: productId,
      reason,
      before: { active: !detail.product.deactivatedAt },
      after: { active },
    });
  });
}

export async function setVariantActive(ctx: ServiceContext, variantId: string, active: boolean) {
  requirePermission(ctx, "catalog.disable");
  const company = requireCompany(ctx);
  const [v] = await db.select().from(productVariants).where(and(eq(productVariants.id, variantId), eq(productVariants.companyId, company.id))).limit(1);
  if (!v) throw new NotFoundError("La variante");
  if (!active) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(productVariants).where(and(eq(productVariants.productId, v.productId), isNull(productVariants.deactivatedAt)));
    if (n <= 1) throw new ConflictError("No puedes desactivar la única variante activa; desactiva el producto.");
  }
  return db.transaction(async (tx) => {
    const now = new Date();
    await tx
      .update(productVariants)
      .set(active ? { deactivatedAt: null, deactivatedBy: null, updatedAt: now, updatedBy: ctx.userId } : { deactivatedAt: now, deactivatedBy: ctx.userId, updatedAt: now, updatedBy: ctx.userId })
      .where(eq(productVariants.id, variantId));
    await recordAudit(tx, ctx.actor, {
      action: active ? "catalog.activate" : "catalog.disable",
      entity: "product_variant",
      entityId: variantId,
      before: { active: !v.deactivatedAt, sku: v.sku },
      after: { active, sku: v.sku },
    });
  });
}

/** Búsqueda rápida de variantes (selectores de inventario). */
export async function searchVariants(ctx: ServiceContext, q: string, limit = 20) {
  requirePermission(ctx, "catalog.view");
  const company = requireCompany(ctx);
  const term = q.trim();
  if (!term) return [];
  const like = `%${term}%`;
  return db
    .select({ id: productVariants.id, productId: products.id, sku: productVariants.sku, variantName: productVariants.variantName, name: products.name, price: productVariants.price, trackStock: products.trackStock })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(
        eq(productVariants.companyId, company.id),
        isNull(productVariants.deactivatedAt),
        isNull(products.deactivatedAt),
        or(
          ilike(products.name, like),
          ilike(productVariants.sku, like),
          ilike(productVariants.variantName, like),
          sql`exists (select 1 from ${barcodes} b where b.variant_id = ${productVariants.id} and b.code = ${term})`,
        ),
      ),
    )
    .orderBy(asc(products.name), asc(productVariants.sortOrder))
    .limit(limit);
}
