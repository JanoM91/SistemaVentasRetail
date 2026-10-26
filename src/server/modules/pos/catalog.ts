import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { barcodes, categories, paymentMethods, products, productVariants, stockBalances, taxProfiles, unitsOfMeasure } from "@/server/db/schema";
import { requirePermission } from "@/server/authz/guard";
import { NotFoundError } from "@/server/errors";
import { requireCompany, type ServiceContext } from "@/server/service-context";
import { getDefaultWarehouse } from "@/server/modules/inventory/service";

export type PosItem = {
  variantId: string;
  productId: string;
  sku: string;
  name: string;
  variantName: string;
  price: number;
  taxRate: number;
  taxIncluded: boolean;
  barcodes: string[];
  categoryId: string | null;
  isFavorite: boolean;
  trackStock: boolean;
  unitCode: string;
  allowsDecimals: boolean;
  stock: number | null;
};

export type PosCatalog = {
  branchId: string;
  warehouseId: string;
  generatedAt: string;
  currency: string;
  categories: Array<{ id: string; name: string; color: string | null }>;
  paymentMethods: Array<{ id: string; code: string; name: string; kind: string; requiresReference: boolean; allowsChange: boolean }>;
  items: PosItem[];
};

/**
 * Catálogo completo para el punto de venta de una sucursal. El POS lo guarda
 * en el dispositivo (IndexedDB) para buscar al instante y vender sin internet.
 */
export async function getPosCatalog(ctx: ServiceContext, branchId?: string | null): Promise<PosCatalog> {
  requirePermission(ctx, "pos.sell");
  const company = requireCompany(ctx);
  const target = branchId ?? ctx.branch?.id;
  if (!target || (!ctx.permissions.has("branches.manage") && !ctx.branches.some((b) => b.id === target))) throw new NotFoundError("La sucursal");
  const wh = await getDefaultWarehouse(db, target);
  const rows = await db
    .select({ v: productVariants, p: products, tax: taxProfiles, unit: unitsOfMeasure, onHand: stockBalances.onHand })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(taxProfiles, eq(taxProfiles.id, products.taxProfileId))
    .innerJoin(unitsOfMeasure, eq(unitsOfMeasure.id, products.unitId))
    .leftJoin(stockBalances, and(eq(stockBalances.variantId, productVariants.id), eq(stockBalances.warehouseId, wh.id)))
    .where(and(eq(productVariants.companyId, company.id), isNull(productVariants.deactivatedAt), isNull(products.deactivatedAt)))
    .orderBy(asc(products.name), asc(productVariants.sortOrder));
  const ids = rows.map((r) => r.v.id);
  const codes = ids.length ? await db.select({ variantId: barcodes.variantId, code: barcodes.code }).from(barcodes).where(inArray(barcodes.variantId, ids)) : [];
  const codesBy = new Map<string, string[]>();
  for (const c of codes) (codesBy.get(c.variantId) ?? codesBy.set(c.variantId, []).get(c.variantId)!).push(c.code);
  const [cats, methods] = await Promise.all([
    db.select({ id: categories.id, name: categories.name, color: categories.color }).from(categories).where(and(eq(categories.companyId, company.id), isNull(categories.deactivatedAt))).orderBy(asc(categories.sortOrder), asc(categories.name)),
    db
      .select({ id: paymentMethods.id, code: paymentMethods.code, name: paymentMethods.name, kind: paymentMethods.kind, requiresReference: paymentMethods.requiresReference, allowsChange: paymentMethods.allowsChange })
      .from(paymentMethods)
      .where(and(eq(paymentMethods.companyId, company.id), eq(paymentMethods.isActive, true)))
      .orderBy(asc(paymentMethods.sortOrder)),
  ]);
  return {
    branchId: target,
    warehouseId: wh.id,
    generatedAt: new Date().toISOString(),
    currency: company.currency,
    categories: cats,
    paymentMethods: methods,
    items: rows.map((r) => ({
      variantId: r.v.id,
      productId: r.p.id,
      sku: r.v.sku,
      name: r.p.name,
      variantName: r.v.variantName,
      price: r.v.price,
      taxRate: Number(r.tax.rate),
      taxIncluded: r.tax.isIncludedInPrice,
      barcodes: codesBy.get(r.v.id) ?? [],
      categoryId: r.p.categoryId,
      isFavorite: r.p.isFavorite,
      trackStock: r.p.trackStock,
      unitCode: r.unit.code,
      allowsDecimals: r.unit.allowsDecimals,
      stock: r.p.trackStock ? Number(r.onHand ?? 0) : null,
    })),
  };
}
