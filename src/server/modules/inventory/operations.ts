import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "@/server/db";
import {
  branches,
  categories,
  products,
  productVariants,
  stockBalances,
  stockCountLines,
  stockCounts,
  stockTransferLines,
  stockTransfers,
  unitsOfMeasure,
  users,
  warehouses,
} from "@/server/db/schema";
import { recordAudit } from "@/server/audit";
import { hasPermission, requirePermission } from "@/server/authz/guard";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { requireCompany, type ServiceContext } from "@/server/service-context";
import { parseOrThrow } from "@/server/validation";
import { normalizeQty, roundHalfEven } from "@/lib/money";
import { postMovement } from "./ledger";
import { allowsNegative, getAccessibleWarehouse, variantLabel } from "./service";
import { nextFolio } from "@/server/modules/sequences";

// ---------------------------------------------------------------- Traspasos

export const transferSchema = z.object({
  fromWarehouseId: z.string().uuid("Elige el almacén de origen"),
  toWarehouseId: z.string().uuid("Elige el almacén de destino"),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  lines: z.array(z.object({ variantId: z.string().uuid(), quantity: z.coerce.number().positive().max(1_000_000) })).min(1, "Agrega al menos un producto").max(300),
});

async function companyWarehouse(companyId: string, id: string) {
  const [wh] = await db.select().from(warehouses).where(and(eq(warehouses.id, id), eq(warehouses.companyId, companyId), isNull(warehouses.deactivatedAt))).limit(1);
  if (!wh) throw new NotFoundError("El almacén");
  return wh;
}

/** Envía mercancía: sale del origen y queda en tránsito hasta que el destino la reciba. */
export async function createTransfer(ctx: ServiceContext, raw: unknown) {
  requirePermission(ctx, "inventory.transfer");
  const company = requireCompany(ctx);
  const input = parseOrThrow(transferSchema, raw);
  if (input.fromWarehouseId === input.toWarehouseId) throw new ValidationError({ toWarehouseId: ["Debe ser distinto al origen."] }, "El origen y el destino deben ser distintos.");
  const from = await getAccessibleWarehouse(ctx, input.fromWarehouseId);
  const to = await companyWarehouse(company.id, input.toWarehouseId);
  const ids = [...new Set(input.lines.map((l) => l.variantId))];
  if (ids.length !== input.lines.length) throw new ValidationError({ lines: ["Producto repetido."] }, "Un producto aparece dos veces.");
  const rows = await db
    .select({ v: productVariants, p: products, allowsDecimals: unitsOfMeasure.allowsDecimals })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(unitsOfMeasure, eq(unitsOfMeasure.id, products.unitId))
    .where(and(eq(productVariants.companyId, company.id), inArray(productVariants.id, ids)));
  const byId = new Map(rows.map((r) => [r.v.id, r]));
  const lines = input.lines.map((l, i) => {
    const r = byId.get(l.variantId);
    if (!r) throw new NotFoundError("Algún producto");
    if (!r.p.trackStock) throw new ValidationError({ [`lines.${i}`]: ["No controla inventario."] }, `${r.p.name} no controla inventario.`);
    const q = normalizeQty(l.quantity);
    if (!r.allowsDecimals && !Number.isInteger(q)) throw new ValidationError({ [`lines.${i}.quantity`]: ["Unidades enteras."] }, `${r.p.name} se maneja en unidades enteras.`);
    return { variantId: l.variantId, quantity: q, label: variantLabel(r.p, r.v) };
  });
  return db.transaction(async (tx) => {
    const folio = await nextFolio(tx, { tenantId: ctx.tenantId, companyId: company.id, branchId: null, documentType: "transfer" });
    const [tr] = await tx
      .insert(stockTransfers)
      .values({ tenantId: ctx.tenantId, companyId: company.id, folio: folio.folio, fromWarehouseId: from.id, toWarehouseId: to.id, fromBranchId: from.branchId, toBranchId: to.branchId, notes: input.notes || null, sentBy: ctx.userId })
      .returning();
    for (const [i, l] of lines.entries()) {
      const mv = await postMovement(tx, {
        tenantId: ctx.tenantId,
        companyId: company.id,
        branchId: from.branchId,
        warehouseId: from.id,
        variantId: l.variantId,
        movementType: "transfer_out",
        quantity: -l.quantity,
        allowNegative: allowsNegative(ctx, from),
        referenceType: "transfer",
        referenceId: tr.id,
        reason: `Traspaso ${tr.folio} a ${to.name}`,
        createdBy: ctx.userId,
        label: l.label,
      });
      await tx.insert(stockTransferLines).values({ tenantId: ctx.tenantId, transferId: tr.id, lineNo: i + 1, variantId: l.variantId, quantitySent: String(l.quantity), unitCost: mv.unitCost, outLedgerId: mv.ledger.id });
    }
    await recordAudit(tx, ctx.actor, { action: "inventory.transfer", entity: "stock_transfer", entityId: tr.id, branchId: from.branchId, after: { folio: tr.folio, from: from.code, to: to.code, lines: lines.map((l) => ({ variantId: l.variantId, qty: l.quantity })) } });
    return tr;
  });
}

async function getTransferRow(ctx: ServiceContext, id: string) {
  requirePermission(ctx, "inventory.view");
  const company = requireCompany(ctx);
  const [tr] = await db.select().from(stockTransfers).where(and(eq(stockTransfers.id, id), eq(stockTransfers.companyId, company.id))).limit(1);
  if (!tr) throw new NotFoundError("El traspaso");
  const canSeeAll = ctx.permissions.has("branches.manage");
  const visible = new Set(ctx.branches.map((b) => b.id));
  if (!canSeeAll && !visible.has(tr.fromBranchId) && !visible.has(tr.toBranchId)) throw new NotFoundError("El traspaso");
  return tr;
}

export const receiveTransferSchema = z.object({
  lines: z.array(z.object({ lineId: z.string().uuid(), quantityReceived: z.coerce.number().min(0).max(1_000_000) })).min(1),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

/** Recibe en el destino lo que realmente llegó; los faltantes quedan documentados. */
export async function receiveTransfer(ctx: ServiceContext, id: string, raw: unknown) {
  requirePermission(ctx, "inventory.transfer");
  const input = parseOrThrow(receiveTransferSchema, raw);
  const tr = await getTransferRow(ctx, id);
  if (tr.status !== "in_transit") throw new ConflictError("El traspaso ya no está en tránsito.");
  const canSeeAll = ctx.permissions.has("branches.manage");
  if (!canSeeAll && !ctx.branches.some((b) => b.id === tr.toBranchId)) throw new ForbiddenError("inventory.transfer", "Solo la sucursal de destino puede recibir el traspaso.");
  const lines = await db.select().from(stockTransferLines).where(eq(stockTransferLines.transferId, id));
  const diffs: Array<{ variantId: string; sent: number; received: number }> = [];
  return db.transaction(async (tx) => {
    for (const l of lines) {
      const given = input.lines.find((x) => x.lineId === l.id);
      const sent = Number(l.quantitySent);
      const received = given ? normalizeQty(given.quantityReceived) : sent;
      if (received > sent + 1e-9) throw new ValidationError({ lines: ["No puedes recibir más de lo enviado."] }, "No puedes recibir más de lo enviado.");
      let inLedgerId: string | null = null;
      if (received > 0) {
        const mv = await postMovement(tx, {
          tenantId: ctx.tenantId,
          companyId: tr.companyId,
          branchId: tr.toBranchId,
          warehouseId: tr.toWarehouseId,
          variantId: l.variantId,
          movementType: "transfer_in",
          quantity: received,
          unitCost: l.unitCost,
          allowNegative: true,
          referenceType: "transfer",
          referenceId: tr.id,
          reason: `Traspaso ${tr.folio} recibido`,
          createdBy: ctx.userId,
        });
        inLedgerId = mv.ledger.id;
      }
      if (received !== sent) diffs.push({ variantId: l.variantId, sent, received });
      await tx.update(stockTransferLines).set({ quantityReceived: String(received), inLedgerId }).where(eq(stockTransferLines.id, l.id));
    }
    await tx.update(stockTransfers).set({ status: "received", receivedBy: ctx.userId, receivedAt: new Date(), receiveNotes: input.notes || null }).where(eq(stockTransfers.id, id));
    await recordAudit(tx, { ...ctx.actor, branchId: tr.toBranchId }, {
      action: "inventory.transfer_receive",
      entity: "stock_transfer",
      entityId: id,
      reason: input.notes || null,
      after: { folio: tr.folio, differences: diffs, lossValue: diffs.reduce((a, d) => a + roundHalfEven((d.sent - d.received) * (lines.find((l) => l.variantId === d.variantId)?.unitCost ?? 0)), 0) },
    });
    return { differences: diffs };
  });
}

/** Cancela un envío en tránsito: la mercancía regresa al origen con movimientos de reverso. */
export async function cancelTransfer(ctx: ServiceContext, id: string, reason: string) {
  requirePermission(ctx, "inventory.authorize");
  if (!reason || reason.trim().length < 3) throw new ValidationError({ reason: ["Explica el motivo."] }, "Explica el motivo.");
  const tr = await getTransferRow(ctx, id);
  if (tr.status !== "in_transit") throw new ConflictError("Solo se cancelan traspasos en tránsito.");
  const lines = await db.select().from(stockTransferLines).where(eq(stockTransferLines.transferId, id));
  await db.transaction(async (tx) => {
    for (const l of lines) {
      await postMovement(tx, {
        tenantId: ctx.tenantId,
        companyId: tr.companyId,
        branchId: tr.fromBranchId,
        warehouseId: tr.fromWarehouseId,
        variantId: l.variantId,
        movementType: "reversal",
        quantity: Number(l.quantitySent),
        unitCost: l.unitCost,
        allowNegative: true,
        referenceType: "transfer",
        referenceId: tr.id,
        reversesId: l.outLedgerId,
        reason: `Cancelación del traspaso ${tr.folio}: ${reason.trim()}`,
        createdBy: ctx.userId,
      });
    }
    await tx.update(stockTransfers).set({ status: "cancelled", cancelledBy: ctx.userId, cancelledAt: new Date(), cancelReason: reason.trim() }).where(eq(stockTransfers.id, id));
    await recordAudit(tx, { ...ctx.actor, branchId: tr.fromBranchId }, { action: "inventory.transfer_cancel", entity: "stock_transfer", entityId: id, reason: reason.trim(), before: { status: "in_transit" }, after: { status: "cancelled" } });
  });
}

const fromWh = alias(warehouses, "from_wh");
const toWh = alias(warehouses, "to_wh");
const fromBr = alias(branches, "from_br");
const toBr = alias(branches, "to_br");

export async function listTransfers(ctx: ServiceContext, opts: { status?: string | null } = {}) {
  requirePermission(ctx, "inventory.view");
  const company = requireCompany(ctx);
  const where: SQL[] = [eq(stockTransfers.companyId, company.id)];
  if (opts.status) where.push(eq(stockTransfers.status, opts.status as never));
  if (!ctx.permissions.has("branches.manage")) {
    const ids = ctx.branches.map((b) => b.id).concat(["00000000-0000-0000-0000-000000000000"]);
    where.push(sql`(${inArray(stockTransfers.fromBranchId, ids)} or ${inArray(stockTransfers.toBranchId, ids)})`);
  }
  const rows = await db
    .select({
      t: stockTransfers,
      fromName: fromWh.name,
      toName: toWh.name,
      fromBranch: fromBr.name,
      toBranch: toBr.name,
      lines: sql<number>`(select count(*) from ${stockTransferLines} l where l.transfer_id = ${stockTransfers.id})`.mapWith(Number),
      value: sql<number>`(select coalesce(sum(round(l.quantity_sent * coalesce(l.unit_cost, 0))), 0) from ${stockTransferLines} l where l.transfer_id = ${stockTransfers.id})`.mapWith(Number),
    })
    .from(stockTransfers)
    .innerJoin(fromWh, eq(fromWh.id, stockTransfers.fromWarehouseId))
    .innerJoin(toWh, eq(toWh.id, stockTransfers.toWarehouseId))
    .innerJoin(fromBr, eq(fromBr.id, stockTransfers.fromBranchId))
    .innerJoin(toBr, eq(toBr.id, stockTransfers.toBranchId))
    .where(and(...where))
    .orderBy(desc(stockTransfers.sentAt))
    .limit(200);
  const showCost = hasPermission(ctx, "inventory.view_cost");
  return rows.map((r) => ({ ...r, value: showCost ? r.value : null }));
}

export async function getTransfer(ctx: ServiceContext, id: string) {
  const tr = await getTransferRow(ctx, id);
  const [from, to] = await Promise.all([companyWarehouse(tr.companyId, tr.fromWarehouseId), db.select().from(warehouses).where(eq(warehouses.id, tr.toWarehouseId)).then((r) => r[0])]);
  const lines = await db
    .select({ l: stockTransferLines, sku: productVariants.sku, name: products.name, variantName: productVariants.variantName })
    .from(stockTransferLines)
    .innerJoin(productVariants, eq(productVariants.id, stockTransferLines.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(stockTransferLines.transferId, id))
    .orderBy(stockTransferLines.lineNo);
  const names = await db.select({ id: users.id, n: users.fullName }).from(users).where(inArray(users.id, [tr.sentBy, tr.receivedBy, tr.cancelledBy].filter(Boolean) as string[]));
  const nameOf = (uid: string | null) => names.find((x) => x.id === uid)?.n ?? null;
  const canReceive = tr.status === "in_transit" && hasPermission(ctx, "inventory.transfer") && (ctx.permissions.has("branches.manage") || ctx.branches.some((b) => b.id === tr.toBranchId));
  const brs = await db.select({ id: branches.id, name: branches.name }).from(branches).where(inArray(branches.id, [tr.fromBranchId, tr.toBranchId]));
  const branchName = (bid: string) => brs.find((b) => b.id === bid)?.name ?? "";
  return { transfer: tr, from, to, fromBranchName: branchName(tr.fromBranchId), toBranchName: branchName(tr.toBranchId), lines, sentByName: nameOf(tr.sentBy), receivedByName: nameOf(tr.receivedBy), cancelledByName: nameOf(tr.cancelledBy), canReceive, canCancel: tr.status === "in_transit" && hasPermission(ctx, "inventory.authorize") };
}

// ---------------------------------------------------------------- Conteos físicos

export const countSchema = z.object({
  warehouseId: z.string().uuid("Elige un almacén"),
  categoryId: z.string().uuid().optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function createCount(ctx: ServiceContext, raw: unknown) {
  requirePermission(ctx, "inventory.count");
  const company = requireCompany(ctx);
  const input = parseOrThrow(countSchema, raw);
  const wh = await getAccessibleWarehouse(ctx, input.warehouseId);
  const [open] = await db.select({ id: stockCounts.id, folio: stockCounts.folio }).from(stockCounts).where(and(eq(stockCounts.warehouseId, wh.id), eq(stockCounts.status, "open"))).limit(1);
  if (open) throw new ConflictError(`Ya hay un conteo abierto en este almacén (${open.folio}). Aplícalo o cancélalo primero.`);
  const where: SQL[] = [eq(productVariants.companyId, company.id), isNull(productVariants.deactivatedAt), isNull(products.deactivatedAt), eq(products.trackStock, true)];
  if (input.categoryId) where.push(eq(products.categoryId, input.categoryId));
  const variants = await db.select({ id: productVariants.id }).from(productVariants).innerJoin(products, eq(products.id, productVariants.productId)).where(and(...where));
  if (!variants.length) throw new ConflictError("No hay productos que contar con ese alcance.");
  return db.transaction(async (tx) => {
    const folio = await nextFolio(tx, { tenantId: ctx.tenantId, companyId: company.id, branchId: null, documentType: "count" });
    const [c] = await tx
      .insert(stockCounts)
      .values({ tenantId: ctx.tenantId, companyId: company.id, branchId: wh.branchId, warehouseId: wh.id, folio: folio.folio, categoryId: input.categoryId || null, notes: input.notes || null, createdBy: ctx.userId })
      .returning();
    await tx.insert(stockCountLines).values(variants.map((v) => ({ tenantId: ctx.tenantId, countId: c.id, variantId: v.id })));
    await recordAudit(tx, ctx.actor, { action: "inventory.count_start", entity: "stock_count", entityId: c.id, branchId: wh.branchId, after: { folio: c.folio, warehouse: wh.code, products: variants.length } });
    return c;
  });
}

async function getCountRow(ctx: ServiceContext, id: string) {
  requirePermission(ctx, "inventory.view");
  const company = requireCompany(ctx);
  const [c] = await db.select().from(stockCounts).where(and(eq(stockCounts.id, id), eq(stockCounts.companyId, company.id))).limit(1);
  if (!c) throw new NotFoundError("El conteo");
  await getAccessibleWarehouse(ctx, c.warehouseId);
  return c;
}

export const recordCountSchema = z.object({
  entries: z.array(z.object({ variantId: z.string().uuid(), countedQty: z.coerce.number().min(0).max(1_000_000) })).min(1).max(1000),
});

/**
 * Captura cantidades contadas. Guarda en cada línea la existencia del sistema
 * en ese momento; la diferencia se calcula contra ella.
 */
export async function recordCount(ctx: ServiceContext, id: string, raw: unknown) {
  requirePermission(ctx, "inventory.count");
  const input = parseOrThrow(recordCountSchema, raw);
  const c = await getCountRow(ctx, id);
  if (c.status !== "open") throw new ConflictError("El conteo ya está cerrado.");
  const ids = input.entries.map((e) => e.variantId);
  const bal = await db.select().from(stockBalances).where(and(eq(stockBalances.warehouseId, c.warehouseId), inArray(stockBalances.variantId, ids)));
  const lines = await db.select().from(stockCountLines).where(and(eq(stockCountLines.countId, id), inArray(stockCountLines.variantId, ids)));
  if (lines.length !== new Set(ids).size) throw new NotFoundError("Algún producto no forma parte de este conteo y");
  await db.transaction(async (tx) => {
    for (const e of input.entries) {
      const system = Number(bal.find((b) => b.variantId === e.variantId)?.onHand ?? 0);
      await tx
        .update(stockCountLines)
        .set({ countedQty: String(normalizeQty(e.countedQty)), systemQty: String(system), countedBy: ctx.userId, countedAt: new Date() })
        .where(and(eq(stockCountLines.countId, id), eq(stockCountLines.variantId, e.variantId)));
    }
  });
  return { saved: input.entries.length };
}

/** Aplica las diferencias del conteo como ajustes en el libro de inventario. */
export async function applyCount(ctx: ServiceContext, id: string, notes?: string) {
  requirePermission(ctx, "inventory.authorize");
  const c = await getCountRow(ctx, id);
  if (c.status !== "open") throw new ConflictError("El conteo ya está cerrado.");
  const lines = await db
    .select({ l: stockCountLines, p: products, v: productVariants })
    .from(stockCountLines)
    .innerJoin(productVariants, eq(productVariants.id, stockCountLines.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(stockCountLines.countId, id));
  const counted = lines.filter((x) => x.l.countedQty !== null);
  if (!counted.length) throw new ConflictError("No hay productos contados.");
  return db.transaction(async (tx) => {
    let adjusted = 0;
    let value = 0;
    for (const x of counted) {
      const diff = normalizeQty(Number(x.l.countedQty) - Number(x.l.systemQty ?? 0));
      if (diff === 0) continue;
      const mv = await postMovement(tx, {
        tenantId: ctx.tenantId,
        companyId: c.companyId,
        branchId: c.branchId,
        warehouseId: c.warehouseId,
        variantId: x.l.variantId,
        movementType: "count_adjustment",
        quantity: diff,
        allowNegative: true,
        referenceType: "stock_count",
        referenceId: c.id,
        reason: `Conteo ${c.folio}: sistema ${Number(x.l.systemQty ?? 0)}, contado ${Number(x.l.countedQty)}`,
        createdBy: ctx.userId,
        label: variantLabel(x.p, x.v),
      });
      await tx.update(stockCountLines).set({ ledgerId: mv.ledger.id }).where(eq(stockCountLines.id, x.l.id));
      adjusted++;
      value += mv.ledger.totalCost ?? 0;
    }
    await tx.update(stockCounts).set({ status: "applied", appliedBy: ctx.userId, appliedAt: new Date(), notes: [c.notes, notes].filter(Boolean).join("\n") || null }).where(eq(stockCounts.id, id));
    await recordAudit(tx, { ...ctx.actor, branchId: c.branchId }, { action: "inventory.count_apply", entity: "stock_count", entityId: id, reason: notes ?? null, after: { folio: c.folio, counted: counted.length, adjusted, valueDifference: value } });
    return { counted: counted.length, adjusted, valueDifference: value };
  });
}

export async function cancelCount(ctx: ServiceContext, id: string, reason: string) {
  requirePermission(ctx, "inventory.count");
  const c = await getCountRow(ctx, id);
  if (c.status !== "open") throw new ConflictError("El conteo ya está cerrado.");
  await db.transaction(async (tx) => {
    await tx.update(stockCounts).set({ status: "cancelled", notes: [c.notes, `Cancelado: ${reason}`].filter(Boolean).join("\n") }).where(eq(stockCounts.id, id));
    await recordAudit(tx, ctx.actor, { action: "inventory.count_cancel", entity: "stock_count", entityId: id, reason, before: { status: "open" }, after: { status: "cancelled" } });
  });
}

export async function getCount(ctx: ServiceContext, id: string) {
  const c = await getCountRow(ctx, id);
  const showCost = hasPermission(ctx, "inventory.view_cost");
  const rows = await db
    .select({ l: stockCountLines, sku: productVariants.sku, name: products.name, variantName: productVariants.variantName, allowsDecimals: unitsOfMeasure.allowsDecimals, onHand: stockBalances.onHand, avgCost: stockBalances.avgCost })
    .from(stockCountLines)
    .innerJoin(productVariants, eq(productVariants.id, stockCountLines.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(unitsOfMeasure, eq(unitsOfMeasure.id, products.unitId))
    .leftJoin(stockBalances, and(eq(stockBalances.variantId, stockCountLines.variantId), eq(stockBalances.warehouseId, c.warehouseId)))
    .where(eq(stockCountLines.countId, id))
    .orderBy(asc(products.name), asc(productVariants.sortOrder));
  const [wh] = await db.select({ name: warehouses.name, branchName: branches.name }).from(warehouses).innerJoin(branches, eq(branches.id, warehouses.branchId)).where(eq(warehouses.id, c.warehouseId));
  const [cat] = c.categoryId ? await db.select({ name: categories.name }).from(categories).where(eq(categories.id, c.categoryId)) : [null];
  const lines = rows.map((r) => {
    const counted = r.l.countedQty === null ? null : Number(r.l.countedQty);
    const system = r.l.systemQty === null ? null : Number(r.l.systemQty);
    const diff = counted === null ? null : normalizeQty(counted - (system ?? 0));
    return { variantId: r.l.variantId, sku: r.sku, name: r.name, variantName: r.variantName, allowsDecimals: r.allowsDecimals, currentOnHand: Number(r.onHand ?? 0), systemQty: system, countedQty: counted, difference: diff, diffValue: showCost && diff !== null && r.avgCost !== null ? roundHalfEven(diff * r.avgCost) : null };
  });
  return { count: c, warehouseName: wh?.name, branchName: wh?.branchName, categoryName: cat?.name ?? null, lines, showCost };
}

export async function listCounts(ctx: ServiceContext) {
  requirePermission(ctx, "inventory.view");
  const company = requireCompany(ctx);
  const rows = await db
    .select({
      c: stockCounts,
      warehouseName: warehouses.name,
      branchName: branches.name,
      total: sql<number>`(select count(*) from ${stockCountLines} l where l.count_id = ${stockCounts.id})`.mapWith(Number),
      counted: sql<number>`(select count(*) from ${stockCountLines} l where l.count_id = ${stockCounts.id} and l.counted_qty is not null)`.mapWith(Number),
    })
    .from(stockCounts)
    .innerJoin(warehouses, eq(warehouses.id, stockCounts.warehouseId))
    .innerJoin(branches, eq(branches.id, stockCounts.branchId))
    .where(eq(stockCounts.companyId, company.id))
    .orderBy(desc(stockCounts.createdAt))
    .limit(100);
  const canSeeAll = ctx.permissions.has("branches.manage");
  const visible = new Set(ctx.branches.map((b) => b.id));
  return rows.filter((r) => canSeeAll || visible.has(r.c.branchId));
}

/** Todos los almacenes activos de la empresa (destinos posibles de un traspaso). */
export async function listCompanyWarehouses(ctx: ServiceContext) {
  requirePermission(ctx, "inventory.transfer");
  const company = requireCompany(ctx);
  return db
    .select({ id: warehouses.id, name: warehouses.name, branchId: warehouses.branchId, branchName: branches.name })
    .from(warehouses)
    .innerJoin(branches, eq(branches.id, warehouses.branchId))
    .where(and(eq(warehouses.companyId, company.id), isNull(warehouses.deactivatedAt), isNull(branches.deactivatedAt)))
    .orderBy(asc(branches.name), asc(warehouses.name));
}
