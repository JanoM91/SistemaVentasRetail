import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/server/db";
import {
  branches,
  inventoryLedger,
  products,
  productVariants,
  stockBalances,
  users,
  warehouses,
  type MovementType,
} from "@/server/db/schema";
import { recordAudit } from "@/server/audit";
import { hasPermission, requirePermission } from "@/server/authz/guard";
import { ConflictError, NotFoundError } from "@/server/errors";
import { requireCompany, type ServiceContext } from "@/server/service-context";
import { parseOrThrow } from "@/server/validation";
import { parseMoney } from "@/lib/money";
import { INBOUND_TYPES, MOVEMENT_LABELS, postMovement } from "./ledger";

/** Almacén de la empresa activa al que el usuario tiene acceso. */
export async function getAccessibleWarehouse(ctx: ServiceContext, warehouseId: string, conn: DbOrTx = db) {
  const company = requireCompany(ctx);
  const [wh] = await conn
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.id, warehouseId), eq(warehouses.companyId, company.id), isNull(warehouses.deactivatedAt)))
    .limit(1);
  if (!wh) throw new NotFoundError("El almacén");
  const canSeeAll = ctx.permissions.has("branches.manage");
  if (!canSeeAll && !ctx.branches.some((b) => b.id === wh.branchId)) throw new NotFoundError("El almacén");
  return wh;
}

/** Almacén principal de una sucursal. */
export async function getDefaultWarehouse(conn: DbOrTx, branchId: string) {
  const [wh] = await conn
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.branchId, branchId), eq(warehouses.isDefault, true), isNull(warehouses.deactivatedAt)))
    .limit(1);
  if (!wh) throw new ConflictError("La sucursal no tiene un almacén principal activo. Configúralo en Sucursales.");
  return wh;
}

export function allowsNegative(ctx: ServiceContext, wh: { allowsNegativeStock: boolean }) {
  return wh.allowsNegativeStock || ctx.company?.settings?.inventory?.allowNegativeStock === true;
}

async function getCompanyVariant(ctx: ServiceContext, variantId: string, conn: DbOrTx = db) {
  const company = requireCompany(ctx);
  const [row] = await conn
    .select({ variant: productVariants, product: products })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(eq(productVariants.id, variantId), eq(productVariants.companyId, company.id)))
    .limit(1);
  if (!row) throw new NotFoundError("El producto");
  return row;
}

export function variantLabel(p: { name: string }, v: { variantName: string; sku: string }) {
  return `${p.name}${v.variantName ? ` (${v.variantName})` : ""} [${v.sku}]`;
}

// ---------------------------------------------------------------- Ajustes

export const MANUAL_MOVEMENT_TYPES = ["opening", "adjustment_in", "adjustment_out", "shrinkage", "damaged", "expired"] as const;

export const adjustmentSchema = z.object({
  warehouseId: z.string().uuid("Elige un almacén"),
  variantId: z.string().uuid("Elige un producto"),
  movementType: z.enum(MANUAL_MOVEMENT_TYPES),
  quantity: z.coerce.number().positive("Debe ser mayor a cero").max(1_000_000, "Cantidad demasiado grande"),
  unitCost: z.union([z.string(), z.number()]).optional().nullable(),
  reason: z.string().trim().min(3, "Explica el motivo (mínimo 3 caracteres)").max(300),
});

/** Entrada, salida, merma o ajuste manual. Siempre con motivo y bitácora. */
export async function registerAdjustment(ctx: ServiceContext, raw: unknown) {
  requirePermission(ctx, "inventory.adjust");
  const input = parseOrThrow(adjustmentSchema, raw);
  const wh = await getAccessibleWarehouse(ctx, input.warehouseId);
  const { variant, product } = await getCompanyVariant(ctx, input.variantId);
  if (!product.trackStock) throw new ConflictError("Este producto no controla inventario.");
  const inbound = INBOUND_TYPES.includes(input.movementType);
  let unitCost: number | null = null;
  if (inbound && input.unitCost !== undefined && input.unitCost !== null && input.unitCost !== "") {
    requirePermission(ctx, "inventory.view_cost");
    unitCost = parseMoney(input.unitCost);
    if (unitCost === null || unitCost < 0) throw new ConflictError("Costo unitario inválido.");
  }
  const signed = inbound ? input.quantity : -input.quantity;
  return db.transaction(async (tx) => {
    const r = await postMovement(tx, {
      tenantId: ctx.tenantId,
      companyId: wh.companyId,
      branchId: wh.branchId,
      warehouseId: wh.id,
      variantId: variant.id,
      movementType: input.movementType,
      quantity: signed,
      unitCost,
      allowNegative: allowsNegative(ctx, wh),
      referenceType: "manual",
      reason: input.reason,
      createdBy: ctx.userId,
      label: variantLabel(product, variant),
    });
    if (inbound && unitCost !== null) {
      // El costo de referencia del catálogo se actualiza al último costo de entrada.
      await tx.update(productVariants).set({ cost: unitCost, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(productVariants.id, variant.id));
    }
    await recordAudit(tx, ctx.actor, {
      action: "inventory.adjust",
      entity: "inventory_ledger",
      entityId: r.ledger.id,
      branchId: wh.branchId,
      reason: input.reason,
      after: {
        type: input.movementType,
        sku: variant.sku,
        warehouse: wh.code,
        quantity: signed,
        unitCost: r.unitCost,
        balanceAfter: r.onHand,
      },
    });
    return r;
  });
}

/**
 * Corrige un movimiento manual registrando el movimiento inverso (nunca se
 * edita el original). Las ventas se corrigen cancelándolas.
 */
export async function reverseMovement(ctx: ServiceContext, ledgerId: string, reason: string) {
  requirePermission(ctx, "inventory.authorize");
  const company = requireCompany(ctx);
  if (!reason || reason.trim().length < 3) throw new ConflictError("Explica el motivo del reverso.");
  const [orig] = await db
    .select()
    .from(inventoryLedger)
    .where(and(eq(inventoryLedger.id, ledgerId), eq(inventoryLedger.companyId, company.id)))
    .limit(1);
  if (!orig) throw new NotFoundError("El movimiento");
  if (!(MANUAL_MOVEMENT_TYPES as readonly string[]).includes(orig.movementType)) {
    throw new ConflictError("Solo se pueden reversar movimientos manuales. Las ventas se corrigen cancelándolas.");
  }
  const wh = await getAccessibleWarehouse(ctx, orig.warehouseId);
  const [already] = await db.select({ id: inventoryLedger.id }).from(inventoryLedger).where(eq(inventoryLedger.reversesId, orig.id)).limit(1);
  if (already) throw new ConflictError("Este movimiento ya fue reversado.");
  const { variant, product } = await getCompanyVariant(ctx, orig.variantId);
  return db.transaction(async (tx) => {
    const r = await postMovement(tx, {
      tenantId: ctx.tenantId,
      companyId: orig.companyId,
      branchId: orig.branchId,
      warehouseId: orig.warehouseId,
      variantId: orig.variantId,
      movementType: "reversal",
      quantity: -Number(orig.quantity),
      unitCost: orig.unitCost,
      forceUnitCost: true,
      allowNegative: allowsNegative(ctx, wh),
      referenceType: "reversal",
      referenceId: orig.id,
      reversesId: orig.id,
      reason: reason.trim(),
      createdBy: ctx.userId,
      label: variantLabel(product, variant),
    });
    await recordAudit(tx, ctx.actor, {
      action: "inventory.reverse",
      entity: "inventory_ledger",
      entityId: r.ledger.id,
      branchId: orig.branchId,
      reason: reason.trim(),
      before: { ledgerId: orig.id, type: orig.movementType, quantity: Number(orig.quantity) },
      after: { reversalId: r.ledger.id, quantity: Number(r.ledger.quantity), balanceAfter: r.onHand },
    });
    return r;
  });
}

// ---------------------------------------------------------------- Consultas

export type StockRow = {
  variantId: string;
  productId: string;
  sku: string;
  name: string;
  variantName: string;
  warehouseId: string | null;
  onHand: number;
  avgCost: number | null;
  value: number | null;
  minStock: number | null;
  reorderPoint: number | null;
  status: "ok" | "low" | "out" | "negative";
};

/** Existencias por variante en un almacén (incluye variantes sin movimientos). */
export async function listStock(
  ctx: ServiceContext,
  opts: { warehouseId: string; q?: string | null; onlyAlerts?: boolean; limit?: number },
): Promise<StockRow[]> {
  requirePermission(ctx, "inventory.view");
  const company = requireCompany(ctx);
  const wh = await getAccessibleWarehouse(ctx, opts.warehouseId);
  const showCost = hasPermission(ctx, "inventory.view_cost");
  const where: SQL[] = [eq(productVariants.companyId, company.id), isNull(productVariants.deactivatedAt), isNull(products.deactivatedAt), eq(products.trackStock, true)];
  if (opts.q) {
    const like = `%${opts.q.trim()}%`;
    where.push(or(ilike(products.name, like), ilike(productVariants.sku, like), ilike(productVariants.variantName, like))!);
  }
  const rows = await db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      sku: productVariants.sku,
      name: products.name,
      variantName: productVariants.variantName,
      onHand: stockBalances.onHand,
      avgCost: stockBalances.avgCost,
      minStock: productVariants.minStock,
      reorderPoint: productVariants.reorderPoint,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(stockBalances, and(eq(stockBalances.variantId, productVariants.id), eq(stockBalances.warehouseId, wh.id)))
    .where(and(...where))
    .orderBy(asc(products.name), asc(productVariants.sortOrder))
    .limit(Math.min(opts.limit ?? 500, 2000));
  const out = rows.map((r) => {
    const onHand = Number(r.onHand ?? 0);
    const min = r.reorderPoint !== null ? Number(r.reorderPoint) : r.minStock !== null ? Number(r.minStock) : null;
    const status: StockRow["status"] = onHand < 0 ? "negative" : onHand === 0 ? "out" : min !== null && onHand <= min ? "low" : "ok";
    return {
      variantId: r.variantId,
      productId: r.productId,
      sku: r.sku,
      name: r.name,
      variantName: r.variantName,
      warehouseId: wh.id,
      onHand,
      avgCost: showCost ? r.avgCost : null,
      value: showCost && r.avgCost !== null ? Math.round(r.avgCost * Math.max(onHand, 0)) : null,
      minStock: r.minStock !== null ? Number(r.minStock) : null,
      reorderPoint: r.reorderPoint !== null ? Number(r.reorderPoint) : null,
      status,
    };
  });
  return opts.onlyAlerts ? out.filter((r) => r.status !== "ok") : out;
}

export type KardexRow = {
  id: string;
  createdAt: Date;
  movementType: MovementType;
  label: string;
  quantity: number;
  unitCost: number | null;
  totalCost: number | null;
  balanceAfter: number;
  avgCostAfter: number | null;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  reversesId: string | null;
  reversedBy: string | null;
  userName: string | null;
  warehouseCode: string;
};

/** Kardex de una variante (todas las bodegas accesibles o una en particular). */
export async function getKardex(ctx: ServiceContext, variantId: string, warehouseId?: string | null) {
  requirePermission(ctx, "inventory.view");
  const { variant, product } = await getCompanyVariant(ctx, variantId);
  const showCost = hasPermission(ctx, "inventory.view_cost");
  const canSeeAll = ctx.permissions.has("branches.manage");
  const where: SQL[] = [eq(inventoryLedger.variantId, variantId), eq(inventoryLedger.companyId, variant.companyId)];
  if (warehouseId) where.push(eq(inventoryLedger.warehouseId, (await getAccessibleWarehouse(ctx, warehouseId)).id));
  else if (!canSeeAll) where.push(inArray(inventoryLedger.branchId, ctx.branches.map((b) => b.id).concat(["00000000-0000-0000-0000-000000000000"])));
  const reversal = db.$with("rev").as(
    db.select({ reversesId: inventoryLedger.reversesId, id: inventoryLedger.id }).from(inventoryLedger).where(sql`${inventoryLedger.reversesId} is not null`),
  );
  const rows = await db
    .with(reversal)
    .select({ l: inventoryLedger, userName: users.fullName, warehouseCode: warehouses.code, reversedBy: reversal.id })
    .from(inventoryLedger)
    .leftJoin(users, eq(users.id, inventoryLedger.createdBy))
    .innerJoin(warehouses, eq(warehouses.id, inventoryLedger.warehouseId))
    .leftJoin(reversal, eq(reversal.reversesId, inventoryLedger.id))
    .where(and(...where))
    .orderBy(desc(inventoryLedger.createdAt))
    .limit(500);
  const items: KardexRow[] = rows.map(({ l, userName, warehouseCode, reversedBy }) => ({
    id: l.id,
    createdAt: l.createdAt,
    movementType: l.movementType,
    label: MOVEMENT_LABELS[l.movementType],
    quantity: Number(l.quantity),
    unitCost: showCost ? l.unitCost : null,
    totalCost: showCost ? l.totalCost : null,
    balanceAfter: Number(l.balanceAfter),
    avgCostAfter: showCost ? l.avgCostAfter : null,
    reason: l.reason,
    referenceType: l.referenceType,
    referenceId: l.referenceId,
    reversesId: l.reversesId,
    reversedBy,
    userName,
    warehouseCode,
  }));
  return { variant, product, items };
}

/** Almacenes accesibles de la empresa activa (para selectores). */
export async function listAccessibleWarehouses(ctx: ServiceContext) {
  const company = requireCompany(ctx);
  const rows = await db
    .select({ id: warehouses.id, code: warehouses.code, name: warehouses.name, branchId: warehouses.branchId, branchName: branches.name, isDefault: warehouses.isDefault })
    .from(warehouses)
    .innerJoin(branches, eq(branches.id, warehouses.branchId))
    .where(and(eq(warehouses.companyId, company.id), isNull(warehouses.deactivatedAt), isNull(branches.deactivatedAt)))
    .orderBy(asc(branches.name), asc(warehouses.name));
  const canSeeAll = ctx.permissions.has("branches.manage");
  const visible = new Set(ctx.branches.map((b) => b.id));
  return rows.filter((r) => canSeeAll || visible.has(r.branchId));
}

/**
 * Verificación de integridad: recalcula la existencia desde el libro y la
 * compara con el saldo materializado. Devuelve las diferencias.
 */
export async function verifyStockIntegrity(conn: DbOrTx, companyId: string) {
  const res = await conn.execute<{ warehouse_id: string; variant_id: string; on_hand: string; ledger_sum: string }>(sql`
    select b.warehouse_id, b.variant_id, b.on_hand::text, coalesce(sum(l.quantity), 0)::text as ledger_sum
    from stock_balances b
    left join inventory_ledger l on l.warehouse_id = b.warehouse_id and l.variant_id = b.variant_id
    where b.company_id = ${companyId}
    group by b.warehouse_id, b.variant_id, b.on_hand
    having b.on_hand <> coalesce(sum(l.quantity), 0)
  `);
  return res.rows;
}
