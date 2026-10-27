import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx, type Tx } from "@/server/db";
import {
  inventoryLedger,
  payablePayments,
  payables,
  productSuppliers,
  products,
  productVariants,
  purchaseOrderLines,
  purchaseOrders,
  purchaseReceiptLines,
  purchaseReceipts,
  stockBalances,
  supplierReturnLines,
  supplierReturns,
  suppliers,
  taxProfiles,
  unitsOfMeasure,
  users,
  warehouses,
} from "@/server/db/schema";
import { recordAudit } from "@/server/audit";
import { hasPermission, requirePermission } from "@/server/authz/guard";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { requireCompany, type ServiceContext } from "@/server/service-context";
import { parseOrThrow } from "@/server/validation";
import { normalizeQty, parseMoney, roundHalfEven } from "@/lib/money";
import { postMovement } from "@/server/modules/inventory/ledger";
import { allowsNegative, getAccessibleWarehouse, variantLabel } from "@/server/modules/inventory/service";
import { nextFolio } from "@/server/modules/sequences";
import { addressSchema, codeSchema, nameSchema } from "@/server/modules/companies/validation";

// ---------------------------------------------------------------- Utilidades

const moneyInput = z.union([z.string(), z.number()]).transform((v, c) => {
  const cents = parseMoney(v);
  if (cents === null || cents < 0) {
    c.addIssue({ code: "custom", message: "Importe inválido" });
    return z.NEVER;
  }
  return cents;
});
const qtyInput = z.coerce.number().positive("Debe ser mayor a cero").max(1_000_000);
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Variantes de la empresa con producto, tasa de impuesto y unidad. */
async function loadVariants(conn: DbOrTx, companyId: string, ids: string[]) {
  if (!ids.length) return new Map<string, Awaited<ReturnType<typeof variantRows>>[number]>();
  const rows = await variantRows(conn, companyId, ids);
  return new Map(rows.map((r) => [r.v.id, r]));
}
function variantRows(conn: DbOrTx, companyId: string, ids: string[]) {
  return conn
    .select({ v: productVariants, p: products, rate: taxProfiles.rate, allowsDecimals: unitsOfMeasure.allowsDecimals })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(taxProfiles, eq(taxProfiles.id, products.taxProfileId))
    .innerJoin(unitsOfMeasure, eq(unitsOfMeasure.id, products.unitId))
    .where(and(eq(productVariants.companyId, companyId), inArray(productVariants.id, ids)));
}

function assertQtyUnit(label: string, allowsDecimals: boolean, q: number, field: string) {
  if (!allowsDecimals && !Number.isInteger(q)) throw new ValidationError({ [field]: [`${label} se maneja en unidades enteras.`] }, `${label} se maneja en unidades enteras.`);
}

// ---------------------------------------------------------------- Proveedores

export const supplierSchema = z.object({
  code: codeSchema,
  name: nameSchema,
  legalName: z.string().trim().max(160).optional().or(z.literal("")),
  taxId: z.string().trim().max(20).optional().or(z.literal("")),
  contactName: z.string().trim().max(120).optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  email: z.string().trim().email("Correo inválido").optional().or(z.literal("")),
  address: addressSchema.optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(0),
  leadTimeDays: z.coerce.number().int().min(0).max(365).default(7),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});
export const supplierUpdateSchema = supplierSchema.omit({ code: true });

export async function listSuppliers(ctx: ServiceContext, opts: { q?: string | null; includeInactive?: boolean } = {}) {
  requirePermission(ctx, "purchases.view");
  const company = requireCompany(ctx);
  const where: SQL[] = [eq(suppliers.companyId, company.id)];
  if (!opts.includeInactive) where.push(isNull(suppliers.deactivatedAt));
  if (opts.q?.trim()) where.push(or(ilike(suppliers.name, `%${opts.q.trim()}%`), ilike(suppliers.code, `%${opts.q.trim()}%`), ilike(suppliers.taxId, `%${opts.q.trim()}%`))!);
  return db
    .select({
      s: suppliers,
      balance: sql<number>`coalesce((select sum(p.balance) from ${payables} p where p.supplier_id = ${suppliers.id} and p.status = 'open'), 0)`.mapWith(Number),
      overdue: sql<number>`coalesce((select sum(p.balance) from ${payables} p where p.supplier_id = ${suppliers.id} and p.status = 'open' and p.due_date < current_date), 0)`.mapWith(Number),
    })
    .from(suppliers)
    .where(and(...where))
    .orderBy(asc(suppliers.name));
}

export async function getSupplier(ctx: ServiceContext, id: string) {
  requirePermission(ctx, "purchases.view");
  const company = requireCompany(ctx);
  const [s] = await db.select().from(suppliers).where(and(eq(suppliers.id, id), eq(suppliers.companyId, company.id))).limit(1);
  if (!s) throw new NotFoundError("El proveedor");
  return s;
}

export async function createSupplier(ctx: ServiceContext, raw: unknown) {
  requirePermission(ctx, "purchases.create");
  const company = requireCompany(ctx);
  const input = parseOrThrow(supplierSchema, raw);
  return db.transaction(async (tx) => {
    const [s] = await tx
      .insert(suppliers)
      .values({
        tenantId: ctx.tenantId,
        companyId: company.id,
        code: input.code,
        name: input.name,
        legalName: input.legalName || null,
        taxId: input.taxId || null,
        contactName: input.contactName || null,
        phone: input.phone || null,
        email: input.email || null,
        address: input.address ?? {},
        paymentTermsDays: input.paymentTermsDays,
        leadTimeDays: input.leadTimeDays,
        notes: input.notes || null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    await recordAudit(tx, ctx.actor, { action: "purchases.supplier_create", entity: "supplier", entityId: s.id, after: { code: s.code, name: s.name } });
    return s;
  });
}

export async function updateSupplier(ctx: ServiceContext, id: string, raw: unknown) {
  requirePermission(ctx, "purchases.create");
  const input = parseOrThrow(supplierUpdateSchema, raw);
  const before = await getSupplier(ctx, id);
  return db.transaction(async (tx) => {
    const [after] = await tx
      .update(suppliers)
      .set({
        name: input.name,
        legalName: input.legalName || null,
        taxId: input.taxId || null,
        contactName: input.contactName || null,
        phone: input.phone || null,
        email: input.email || null,
        address: input.address ?? before.address,
        paymentTermsDays: input.paymentTermsDays,
        leadTimeDays: input.leadTimeDays,
        notes: input.notes || null,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(eq(suppliers.id, id))
      .returning();
    await recordAudit(tx, ctx.actor, {
      action: "purchases.supplier_update",
      entity: "supplier",
      entityId: id,
      before: { name: before.name, paymentTermsDays: before.paymentTermsDays, leadTimeDays: before.leadTimeDays, taxId: before.taxId },
      after: { name: after.name, paymentTermsDays: after.paymentTermsDays, leadTimeDays: after.leadTimeDays, taxId: after.taxId },
    });
    return after;
  });
}

export async function setSupplierActive(ctx: ServiceContext, id: string, active: boolean, reason?: string) {
  requirePermission(ctx, "purchases.create");
  const before = await getSupplier(ctx, id);
  await db.transaction(async (tx) => {
    const now = new Date();
    await tx
      .update(suppliers)
      .set(active ? { deactivatedAt: null, deactivatedBy: null, updatedAt: now, updatedBy: ctx.userId } : { deactivatedAt: now, deactivatedBy: ctx.userId, updatedAt: now, updatedBy: ctx.userId })
      .where(eq(suppliers.id, id));
    await recordAudit(tx, ctx.actor, { action: active ? "purchases.supplier_activate" : "purchases.supplier_deactivate", entity: "supplier", entityId: id, reason, before: { active: !before.deactivatedAt }, after: { active } });
  });
}

/** Historial de costos de compra de un proveedor (últimas recepciones por producto). */
export async function supplierPriceHistory(ctx: ServiceContext, supplierId: string, limit = 100) {
  requirePermission(ctx, "purchases.view");
  await getSupplier(ctx, supplierId);
  return db
    .select({ receivedAt: purchaseReceipts.receivedAt, folio: purchaseReceipts.folio, sku: productVariants.sku, name: products.name, variantName: productVariants.variantName, quantity: purchaseReceiptLines.quantity, unitCost: purchaseReceiptLines.unitCost, landedUnitCost: purchaseReceiptLines.landedUnitCost })
    .from(purchaseReceiptLines)
    .innerJoin(purchaseReceipts, eq(purchaseReceipts.id, purchaseReceiptLines.receiptId))
    .innerJoin(productVariants, eq(productVariants.id, purchaseReceiptLines.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(purchaseReceipts.supplierId, supplierId))
    .orderBy(desc(purchaseReceipts.receivedAt))
    .limit(limit);
}

// ---------------------------------------------------------------- Órdenes de compra

export const poSchema = z.object({
  supplierId: z.string().uuid("Elige un proveedor"),
  warehouseId: z.string().uuid("Elige el almacén de destino"),
  expectedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  lines: z.array(z.object({ variantId: z.string().uuid(), quantity: qtyInput, unitCost: moneyInput })).min(1, "Agrega al menos un producto").max(300),
});

function poTotals(lines: Array<{ quantity: number; unitCost: number; taxRate: number }>) {
  let subtotal = 0, tax = 0;
  for (const l of lines) {
    const net = roundHalfEven(l.quantity * l.unitCost);
    subtotal += net;
    tax += roundHalfEven(net * l.taxRate);
  }
  return { subtotal, tax, total: subtotal + tax };
}

async function preparePoLines(ctx: ServiceContext, companyId: string, lines: z.infer<typeof poSchema>["lines"]) {
  const ids = [...new Set(lines.map((l) => l.variantId))];
  if (ids.length !== lines.length) throw new ValidationError({ lines: ["Un producto aparece dos veces; junta las cantidades."] }, "Un producto aparece dos veces en la orden.");
  const vmap = await loadVariants(db, companyId, ids);
  return lines.map((l, i) => {
    const r = vmap.get(l.variantId);
    if (!r) throw new NotFoundError("Algún producto");
    if (!r.p.trackStock) throw new ValidationError({ [`lines.${i}`]: ["No controla inventario."] }, `${r.p.name} no controla inventario.`);
    const q = normalizeQty(l.quantity);
    assertQtyUnit(variantLabel(r.p, r.v), r.allowsDecimals, q, `lines.${i}.quantity`);
    return { variantId: l.variantId, quantity: q, unitCost: l.unitCost, taxRate: Number(r.rate) };
  });
}

export async function createPurchaseOrder(ctx: ServiceContext, raw: unknown) {
  requirePermission(ctx, "purchases.create");
  const company = requireCompany(ctx);
  const input = parseOrThrow(poSchema, raw);
  const supplier = await getSupplier(ctx, input.supplierId);
  if (supplier.deactivatedAt) throw new ConflictError("El proveedor está desactivado.");
  const wh = await getAccessibleWarehouse(ctx, input.warehouseId);
  const lines = await preparePoLines(ctx, company.id, input.lines);
  const t = poTotals(lines);
  return db.transaction(async (tx) => {
    const folio = await nextFolio(tx, { tenantId: ctx.tenantId, companyId: company.id, branchId: null, documentType: "purchase" });
    const [po] = await tx
      .insert(purchaseOrders)
      .values({
        tenantId: ctx.tenantId,
        companyId: company.id,
        branchId: wh.branchId,
        warehouseId: wh.id,
        supplierId: supplier.id,
        folio: folio.folio,
        expectedAt: input.expectedAt || null,
        notes: input.notes || null,
        subtotal: t.subtotal,
        taxTotal: t.tax,
        total: t.total,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    await tx.insert(purchaseOrderLines).values(lines.map((l, i) => ({ tenantId: ctx.tenantId, purchaseOrderId: po.id, lineNo: i + 1, variantId: l.variantId, quantityOrdered: String(l.quantity), unitCost: l.unitCost, taxRate: String(l.taxRate) })));
    await recordAudit(tx, ctx.actor, { action: "purchases.create", entity: "purchase_order", entityId: po.id, branchId: wh.branchId, after: { folio: po.folio, supplier: supplier.name, lines: lines.length, total: t.total } });
    return po;
  });
}

async function getPoRow(ctx: ServiceContext, id: string, conn: DbOrTx = db) {
  requirePermission(ctx, "purchases.view");
  const company = requireCompany(ctx);
  const [po] = await conn.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.companyId, company.id))).limit(1);
  if (!po) throw new NotFoundError("La orden de compra");
  return po;
}

export async function updatePurchaseOrder(ctx: ServiceContext, id: string, raw: unknown) {
  requirePermission(ctx, "purchases.create");
  const company = requireCompany(ctx);
  const po = await getPoRow(ctx, id);
  if (po.status !== "draft") throw new ConflictError("Solo se editan órdenes en borrador.");
  const input = parseOrThrow(poSchema, raw);
  const wh = await getAccessibleWarehouse(ctx, input.warehouseId);
  const lines = await preparePoLines(ctx, company.id, input.lines);
  const t = poTotals(lines);
  return db.transaction(async (tx) => {
    await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id));
    await tx.insert(purchaseOrderLines).values(lines.map((l, i) => ({ tenantId: ctx.tenantId, purchaseOrderId: id, lineNo: i + 1, variantId: l.variantId, quantityOrdered: String(l.quantity), unitCost: l.unitCost, taxRate: String(l.taxRate) })));
    const [after] = await tx
      .update(purchaseOrders)
      .set({ supplierId: input.supplierId, warehouseId: wh.id, branchId: wh.branchId, expectedAt: input.expectedAt || null, notes: input.notes || null, subtotal: t.subtotal, taxTotal: t.tax, total: t.total, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(purchaseOrders.id, id))
      .returning();
    await recordAudit(tx, ctx.actor, { action: "purchases.update", entity: "purchase_order", entityId: id, before: { total: po.total }, after: { total: after.total, lines: lines.length } });
    return after;
  });
}

/** Envía (autoriza) la orden: deja de ser editable y puede recibirse. */
export async function sendPurchaseOrder(ctx: ServiceContext, id: string) {
  requirePermission(ctx, "purchases.authorize");
  const po = await getPoRow(ctx, id);
  if (po.status !== "draft") throw new ConflictError("La orden ya fue enviada.");
  await db.transaction(async (tx) => {
    await tx.update(purchaseOrders).set({ status: "sent", sentAt: new Date(), sentBy: ctx.userId, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(purchaseOrders.id, id));
    await recordAudit(tx, ctx.actor, { action: "purchases.authorize", entity: "purchase_order", entityId: id, branchId: po.branchId, before: { status: po.status }, after: { status: "sent", total: po.total } });
  });
}

/**
 * Cancela una orden sin recepciones, o cierra una parcialmente recibida
 * (lo pendiente ya no se espera).
 */
export async function cancelPurchaseOrder(ctx: ServiceContext, id: string, reason: string) {
  requirePermission(ctx, "purchases.authorize");
  if (!reason || reason.trim().length < 3) throw new ValidationError({ reason: ["Explica el motivo."] }, "Explica el motivo.");
  const po = await getPoRow(ctx, id);
  if (po.status === "received" || po.status === "cancelled") throw new ConflictError("La orden ya está cerrada.");
  const status = po.status === "partial" ? "received" : "cancelled";
  await db.transaction(async (tx) => {
    await tx.update(purchaseOrders).set({ status, cancelledAt: new Date(), cancelReason: reason.trim(), updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(purchaseOrders.id, id));
    await recordAudit(tx, ctx.actor, { action: status === "cancelled" ? "purchases.cancel" : "purchases.close", entity: "purchase_order", entityId: id, reason: reason.trim(), before: { status: po.status }, after: { status } });
  });
  return status;
}

export async function listPurchaseOrders(ctx: ServiceContext, opts: { status?: string | null; supplierId?: string | null; limit?: number } = {}) {
  requirePermission(ctx, "purchases.view");
  const company = requireCompany(ctx);
  const where: SQL[] = [eq(purchaseOrders.companyId, company.id)];
  if (opts.status === "open") where.push(inArray(purchaseOrders.status, ["draft", "sent", "partial"]));
  else if (opts.status) where.push(eq(purchaseOrders.status, opts.status as never));
  if (opts.supplierId) where.push(eq(purchaseOrders.supplierId, opts.supplierId));
  return db
    .select({ po: purchaseOrders, supplierName: suppliers.name, warehouseName: warehouses.name })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .innerJoin(warehouses, eq(warehouses.id, purchaseOrders.warehouseId))
    .where(and(...where))
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(Math.min(opts.limit ?? 100, 300));
}

export async function getPurchaseOrder(ctx: ServiceContext, id: string) {
  const po = await getPoRow(ctx, id);
  const [supplier, lines, receipts, wh] = await Promise.all([
    getSupplier(ctx, po.supplierId),
    db
      .select({ l: purchaseOrderLines, sku: productVariants.sku, name: products.name, variantName: productVariants.variantName })
      .from(purchaseOrderLines)
      .innerJoin(productVariants, eq(productVariants.id, purchaseOrderLines.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(purchaseOrderLines.purchaseOrderId, id))
      .orderBy(purchaseOrderLines.lineNo),
    db.select().from(purchaseReceipts).where(eq(purchaseReceipts.purchaseOrderId, id)).orderBy(desc(purchaseReceipts.receivedAt)),
    db.select().from(warehouses).where(eq(warehouses.id, po.warehouseId)).limit(1),
  ]);
  return { po, supplier, warehouse: wh[0], lines: lines.map((r) => ({ ...r.l, quantityOrdered: Number(r.l.quantityOrdered), quantityReceived: Number(r.l.quantityReceived), taxRate: Number(r.l.taxRate), sku: r.sku, name: r.name, variantName: r.variantName })), receipts };
}

// ---------------------------------------------------------------- Recepción (compra)

export const receiptSchema = z.object({
  purchaseOrderId: z.string().uuid().optional().or(z.literal("")),
  supplierId: z.string().uuid().optional().or(z.literal("")),
  warehouseId: z.string().uuid().optional().or(z.literal("")),
  supplierInvoice: z.string().trim().max(60).optional().or(z.literal("")),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).optional(),
  extraCosts: z.array(z.object({ concept: z.string().trim().min(2).max(60), amount: moneyInput })).max(10).default([]),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  lines: z
    .array(z.object({ purchaseOrderLineId: z.string().uuid().optional().or(z.literal("")), variantId: z.string().uuid(), quantity: qtyInput, unitCost: moneyInput }))
    .min(1, "Agrega al menos un producto recibido")
    .max(300),
});

/**
 * Registra mercancía recibida (de una orden o compra directa): entra al
 * inventario al costo con flete prorrateado, actualiza la orden, el último
 * costo y crea la cuenta por pagar.
 */
export async function receivePurchase(ctx: ServiceContext, raw: unknown) {
  requirePermission(ctx, "purchases.receive");
  const company = requireCompany(ctx);
  const input = parseOrThrow(receiptSchema, raw);
  const po = input.purchaseOrderId ? await getPoRow(ctx, input.purchaseOrderId) : null;
  if (po && po.status !== "sent" && po.status !== "partial") throw new ConflictError(po.status === "draft" ? "Envía (autoriza) la orden antes de recibir." : "La orden ya está cerrada.");
  const supplierId = po?.supplierId ?? input.supplierId;
  if (!supplierId) throw new ValidationError({ supplierId: ["Elige un proveedor."] }, "Elige un proveedor.");
  const supplier = await getSupplier(ctx, supplierId);
  const wh = await getAccessibleWarehouse(ctx, po?.warehouseId ?? input.warehouseId ?? "");
  const vmap = await loadVariants(db, company.id, [...new Set(input.lines.map((l) => l.variantId))]);
  const poLines = po ? await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id)) : [];

  const lines = input.lines.map((l, i) => {
    const r = vmap.get(l.variantId);
    if (!r) throw new NotFoundError("Algún producto");
    if (!r.p.trackStock) throw new ValidationError({ [`lines.${i}`]: ["No controla inventario."] }, `${r.p.name} no controla inventario.`);
    const q = normalizeQty(l.quantity);
    const label = variantLabel(r.p, r.v);
    assertQtyUnit(label, r.allowsDecimals, q, `lines.${i}.quantity`);
    let poLine: (typeof poLines)[number] | null = null;
    if (po) {
      poLine = poLines.find((x) => x.id === l.purchaseOrderLineId) ?? poLines.find((x) => x.variantId === l.variantId) ?? null;
      if (!poLine || poLine.variantId !== l.variantId) throw new ValidationError({ [`lines.${i}`]: ["No está en la orden."] }, `${label} no está en la orden de compra.`);
      const pending = normalizeQty(Number(poLine.quantityOrdered) - Number(poLine.quantityReceived));
      if (q > pending + 1e-9) throw new ValidationError({ [`lines.${i}.quantity`]: [`Excede lo pendiente (${pending}).`] }, `${label}: se reciben ${q} pero solo faltan ${pending}.`);
    }
    return { ...l, quantity: q, label, r, poLine, taxRate: Number(r.rate), net: roundHalfEven(q * l.unitCost) };
  });
  if (new Set(lines.map((l) => l.variantId)).size !== lines.length) throw new ValidationError({ lines: ["Producto repetido."] }, "Un producto aparece dos veces en la recepción.");

  const subtotal = lines.reduce((a, l) => a + l.net, 0);
  const extra = input.extraCosts.reduce((a, c) => a + c.amount, 0);
  const taxTotal = lines.reduce((a, l) => a + roundHalfEven(l.net * l.taxRate), 0);
  const total = subtotal + taxTotal + extra;
  // Prorrateo del costo adicional por valor (o por cantidad si todo vale cero).
  const base = subtotal > 0 ? subtotal : lines.reduce((a, l) => a + l.quantity, 0);
  let assigned = 0;
  const landed = lines.map((l, i) => {
    const weight = subtotal > 0 ? l.net : l.quantity;
    const share = i === lines.length - 1 ? extra - assigned : roundHalfEven((extra * weight) / base);
    assigned += share;
    return roundHalfEven(l.unitCost + share / l.quantity);
  });
  const invoiceDate = input.invoiceDate || today();
  const terms = input.paymentTermsDays ?? supplier.paymentTermsDays;

  return db.transaction(async (tx) => {
    const folio = await nextFolio(tx, { tenantId: ctx.tenantId, companyId: company.id, branchId: null, documentType: "receipt" });
    const [receipt] = await tx
      .insert(purchaseReceipts)
      .values({
        tenantId: ctx.tenantId,
        companyId: company.id,
        branchId: wh.branchId,
        warehouseId: wh.id,
        supplierId: supplier.id,
        purchaseOrderId: po?.id ?? null,
        folio: folio.folio,
        supplierInvoice: input.supplierInvoice || null,
        invoiceDate,
        subtotal,
        extraCosts: extra,
        extraCostsDetail: input.extraCosts,
        taxTotal,
        total,
        notes: input.notes || null,
        receivedBy: ctx.userId,
      })
      .returning();
    for (const [i, l] of lines.entries()) {
      const mv = await postMovement(tx, {
        tenantId: ctx.tenantId,
        companyId: company.id,
        branchId: wh.branchId,
        warehouseId: wh.id,
        variantId: l.variantId,
        movementType: "purchase_in",
        quantity: l.quantity,
        unitCost: landed[i],
        allowNegative: true,
        referenceType: "purchase_receipt",
        referenceId: receipt.id,
        reason: `Compra ${receipt.folio} · ${supplier.name}${input.supplierInvoice ? ` · factura ${input.supplierInvoice}` : ""}`,
        createdBy: ctx.userId,
        label: l.label,
      });
      await tx.insert(purchaseReceiptLines).values({
        tenantId: ctx.tenantId,
        receiptId: receipt.id,
        purchaseOrderLineId: l.poLine?.id ?? null,
        variantId: l.variantId,
        quantity: String(l.quantity),
        unitCost: l.unitCost,
        landedUnitCost: landed[i],
        taxRate: String(l.taxRate),
        ledgerId: mv.ledger.id,
      });
      if (l.poLine) {
        await tx
          .update(purchaseOrderLines)
          .set({ quantityReceived: sql`${purchaseOrderLines.quantityReceived} + ${String(l.quantity)}` })
          .where(eq(purchaseOrderLines.id, l.poLine.id));
      }
      await tx.update(productVariants).set({ cost: landed[i], updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(productVariants.id, l.variantId));
      await upsertProductSupplier(tx, ctx, l.r.p.id, supplier.id, l.unitCost);
    }
    if (po) {
      const after = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
      const complete = after.every((x) => Number(x.quantityReceived) >= Number(x.quantityOrdered) - 1e-9);
      await tx.update(purchaseOrders).set({ status: complete ? "received" : "partial", updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(purchaseOrders.id, po.id));
    }
    await tx.insert(payables).values({ tenantId: ctx.tenantId, companyId: company.id, supplierId: supplier.id, receiptId: receipt.id, amount: total, balance: total, dueDate: addDays(invoiceDate, terms), status: total > 0 ? "open" : "paid" });
    await recordAudit(tx, ctx.actor, {
      action: "purchases.receive",
      entity: "purchase_receipt",
      entityId: receipt.id,
      branchId: wh.branchId,
      after: { folio: receipt.folio, order: po?.folio ?? null, supplier: supplier.name, invoice: input.supplierInvoice || null, subtotal, extraCosts: extra, tax: taxTotal, total, lines: lines.map((l, i) => ({ sku: l.r.v.sku, qty: l.quantity, unitCost: l.unitCost, landed: landed[i] })) },
    });
    return receipt;
  });
}

async function upsertProductSupplier(tx: Tx, ctx: ServiceContext, productId: string, supplierId: string, lastCost: number) {
  const company = requireCompany(ctx);
  const [primary] = await tx.select({ id: productSuppliers.id }).from(productSuppliers).where(and(eq(productSuppliers.productId, productId), eq(productSuppliers.isPrimary, true))).limit(1);
  await tx
    .insert(productSuppliers)
    .values({ tenantId: ctx.tenantId, companyId: company.id, productId, supplierId, isPrimary: !primary, lastCost, lastPurchaseAt: new Date(), createdBy: ctx.userId, updatedBy: ctx.userId })
    .onConflictDoUpdate({ target: [productSuppliers.productId, productSuppliers.supplierId], set: { lastCost, lastPurchaseAt: new Date(), updatedAt: new Date(), updatedBy: ctx.userId } });
}

export async function listReceipts(ctx: ServiceContext, opts: { supplierId?: string | null; limit?: number } = {}) {
  requirePermission(ctx, "purchases.view");
  const company = requireCompany(ctx);
  const where: SQL[] = [eq(purchaseReceipts.companyId, company.id)];
  if (opts.supplierId) where.push(eq(purchaseReceipts.supplierId, opts.supplierId));
  return db
    .select({ r: purchaseReceipts, supplierName: suppliers.name, orderFolio: purchaseOrders.folio, warehouseName: warehouses.name })
    .from(purchaseReceipts)
    .innerJoin(suppliers, eq(suppliers.id, purchaseReceipts.supplierId))
    .innerJoin(warehouses, eq(warehouses.id, purchaseReceipts.warehouseId))
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, purchaseReceipts.purchaseOrderId))
    .where(and(...where))
    .orderBy(desc(purchaseReceipts.receivedAt))
    .limit(Math.min(opts.limit ?? 100, 300));
}

export async function getReceipt(ctx: ServiceContext, id: string) {
  requirePermission(ctx, "purchases.view");
  const company = requireCompany(ctx);
  const [row] = await db
    .select({ r: purchaseReceipts, supplier: suppliers, warehouseName: warehouses.name, orderFolio: purchaseOrders.folio, receivedByName: users.fullName })
    .from(purchaseReceipts)
    .innerJoin(suppliers, eq(suppliers.id, purchaseReceipts.supplierId))
    .innerJoin(warehouses, eq(warehouses.id, purchaseReceipts.warehouseId))
    .innerJoin(users, eq(users.id, purchaseReceipts.receivedBy))
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, purchaseReceipts.purchaseOrderId))
    .where(and(eq(purchaseReceipts.id, id), eq(purchaseReceipts.companyId, company.id)))
    .limit(1);
  if (!row) throw new NotFoundError("La recepción");
  const lines = await db
    .select({ l: purchaseReceiptLines, sku: productVariants.sku, name: products.name, variantName: productVariants.variantName })
    .from(purchaseReceiptLines)
    .innerJoin(productVariants, eq(productVariants.id, purchaseReceiptLines.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(purchaseReceiptLines.receiptId, id));
  const [payable] = await db.select().from(payables).where(eq(payables.receiptId, id)).limit(1);
  return { ...row, lines, payable: payable ?? null };
}

// ---------------------------------------------------------------- Devolución a proveedor

export const supplierReturnSchema = z.object({
  supplierId: z.string().uuid("Elige un proveedor"),
  warehouseId: z.string().uuid("Elige un almacén"),
  receiptId: z.string().uuid().optional().or(z.literal("")),
  reason: z.string().trim().min(3, "Explica el motivo").max(300),
  lines: z.array(z.object({ variantId: z.string().uuid(), quantity: qtyInput, unitCost: z.union([z.string(), z.number()]).optional().nullable() })).min(1).max(200),
});

/** Devuelve mercancía al proveedor: sale del inventario y genera nota de crédito contra su cuenta. */
export async function createSupplierReturn(ctx: ServiceContext, raw: unknown) {
  requirePermission(ctx, "purchases.return");
  const company = requireCompany(ctx);
  const input = parseOrThrow(supplierReturnSchema, raw);
  const supplier = await getSupplier(ctx, input.supplierId);
  const wh = await getAccessibleWarehouse(ctx, input.warehouseId);
  const receipt = input.receiptId ? (await getReceipt(ctx, input.receiptId)) : null;
  if (receipt && receipt.r.supplierId !== supplier.id) throw new ConflictError("La recepción es de otro proveedor.");
  const vmap = await loadVariants(db, company.id, [...new Set(input.lines.map((l) => l.variantId))]);
  const balances = await db.select().from(stockBalances).where(and(eq(stockBalances.warehouseId, wh.id), inArray(stockBalances.variantId, [...vmap.keys()])));
  const lines = input.lines.map((l, i) => {
    const r = vmap.get(l.variantId);
    if (!r) throw new NotFoundError("Algún producto");
    const q = normalizeQty(l.quantity);
    assertQtyUnit(variantLabel(r.p, r.v), r.allowsDecimals, q, `lines.${i}.quantity`);
    const fromReceipt = receipt?.lines.find((x) => x.l.variantId === l.variantId)?.l.unitCost ?? null;
    const given = l.unitCost !== undefined && l.unitCost !== null && l.unitCost !== "" ? parseMoney(l.unitCost) : null;
    const avg = balances.find((b) => b.variantId === l.variantId)?.avgCost ?? null;
    const unitCost = given ?? fromReceipt ?? avg ?? r.v.cost ?? 0;
    return { variantId: l.variantId, quantity: q, unitCost, taxRate: Number(r.rate), label: variantLabel(r.p, r.v) };
  });
  const credit = lines.reduce((a, l) => a + roundHalfEven(roundHalfEven(l.quantity * l.unitCost) * (1 + l.taxRate)), 0);

  return db.transaction(async (tx) => {
    const folio = await nextFolio(tx, { tenantId: ctx.tenantId, companyId: company.id, branchId: null, documentType: "supplier_return" });
    const [ret] = await tx
      .insert(supplierReturns)
      .values({ tenantId: ctx.tenantId, companyId: company.id, branchId: wh.branchId, warehouseId: wh.id, supplierId: supplier.id, receiptId: receipt?.r.id ?? null, folio: folio.folio, reason: input.reason, creditAmount: credit, createdBy: ctx.userId })
      .returning();
    for (const l of lines) {
      const mv = await postMovement(tx, {
        tenantId: ctx.tenantId,
        companyId: company.id,
        branchId: wh.branchId,
        warehouseId: wh.id,
        variantId: l.variantId,
        movementType: "supplier_return_out",
        quantity: -l.quantity,
        unitCost: l.unitCost,
        forceUnitCost: true,
        allowNegative: allowsNegative(ctx, wh),
        referenceType: "supplier_return",
        referenceId: ret.id,
        reason: `${ret.folio} · ${input.reason}`,
        createdBy: ctx.userId,
        label: l.label,
      });
      await tx.insert(supplierReturnLines).values({ tenantId: ctx.tenantId, supplierReturnId: ret.id, variantId: l.variantId, quantity: String(l.quantity), unitCost: l.unitCost, taxRate: String(l.taxRate), ledgerId: mv.ledger.id });
    }
    // Nota de crédito: se aplica a la cuenta de la recepción o a la más antigua abierta del proveedor.
    let remaining = credit;
    const open = await tx
      .select()
      .from(payables)
      .where(and(eq(payables.supplierId, supplier.id), eq(payables.status, "open")))
      .orderBy(receipt ? sql`(${payables.receiptId} = ${receipt.r.id}) desc` : sql`1`, asc(payables.dueDate))
      .for("update");
    for (const p of open) {
      if (remaining <= 0) break;
      const applied = Math.min(remaining, p.balance);
      remaining -= applied;
      await tx.insert(payablePayments).values({ tenantId: ctx.tenantId, payableId: p.id, kind: "credit_note", amount: applied, method: "Nota de crédito", reference: ret.folio, supplierReturnId: ret.id, paidAt: today(), createdBy: ctx.userId });
      await tx.update(payables).set({ balance: p.balance - applied, status: p.balance - applied === 0 ? "paid" : "open" }).where(eq(payables.id, p.id));
    }
    await recordAudit(tx, ctx.actor, {
      action: "purchases.return",
      entity: "supplier_return",
      entityId: ret.id,
      branchId: wh.branchId,
      reason: input.reason,
      after: { folio: ret.folio, supplier: supplier.name, credit, appliedToPayables: credit - remaining, pendingCredit: remaining, lines: lines.map((l) => ({ variantId: l.variantId, qty: l.quantity, unitCost: l.unitCost })) },
    });
    return { ...ret, pendingCredit: remaining };
  });
}

export async function listSupplierReturns(ctx: ServiceContext, opts: { limit?: number } = {}) {
  requirePermission(ctx, "purchases.view");
  const company = requireCompany(ctx);
  return db
    .select({ r: supplierReturns, supplierName: suppliers.name })
    .from(supplierReturns)
    .innerJoin(suppliers, eq(suppliers.id, supplierReturns.supplierId))
    .where(eq(supplierReturns.companyId, company.id))
    .orderBy(desc(supplierReturns.createdAt))
    .limit(Math.min(opts.limit ?? 100, 300));
}

// ---------------------------------------------------------------- Cuentas por pagar

export async function listPayables(ctx: ServiceContext, opts: { status?: "open" | "paid" | null; supplierId?: string | null } = {}) {
  requirePermission(ctx, "purchases.view");
  const company = requireCompany(ctx);
  const where: SQL[] = [eq(payables.companyId, company.id)];
  if (opts.status) where.push(eq(payables.status, opts.status));
  if (opts.supplierId) where.push(eq(payables.supplierId, opts.supplierId));
  const rows = await db
    .select({ p: payables, supplierName: suppliers.name, receiptFolio: purchaseReceipts.folio, supplierInvoice: purchaseReceipts.supplierInvoice })
    .from(payables)
    .innerJoin(suppliers, eq(suppliers.id, payables.supplierId))
    .innerJoin(purchaseReceipts, eq(purchaseReceipts.id, payables.receiptId))
    .where(and(...where))
    .orderBy(asc(payables.dueDate))
    .limit(500);
  const t = today();
  return rows.map((r) => ({ ...r, overdue: r.p.status === "open" && r.p.dueDate < t, dueSoon: r.p.status === "open" && r.p.dueDate >= t && r.p.dueDate <= addDays(t, 7) }));
}

export const payablePaymentSchema = z.object({
  payableId: z.string().uuid(),
  amount: moneyInput,
  method: z.string().trim().min(2, "Indica el método").max(40),
  reference: z.string().trim().max(80).optional().or(z.literal("")),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
});

export async function payPayable(ctx: ServiceContext, raw: unknown) {
  requirePermission(ctx, "purchases.authorize");
  const company = requireCompany(ctx);
  const input = parseOrThrow(payablePaymentSchema, raw);
  if (input.amount <= 0) throw new ValidationError({ amount: ["Debe ser mayor a cero."] }, "El importe debe ser mayor a cero.");
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payables).where(and(eq(payables.id, input.payableId), eq(payables.companyId, company.id))).for("update");
    if (!p) throw new NotFoundError("La cuenta por pagar");
    if (p.status !== "open") throw new ConflictError("La cuenta ya está pagada.");
    if (input.amount > p.balance) throw new ValidationError({ amount: [`El saldo es ${(p.balance / 100).toFixed(2)}.`] }, `El pago excede el saldo (${(p.balance / 100).toFixed(2)}).`);
    const balance = p.balance - input.amount;
    await tx.insert(payablePayments).values({ tenantId: ctx.tenantId, payableId: p.id, kind: "payment", amount: input.amount, method: input.method, reference: input.reference || null, paidAt: input.paidAt || today(), createdBy: ctx.userId });
    await tx.update(payables).set({ balance, status: balance === 0 ? "paid" : "open" }).where(eq(payables.id, p.id));
    await recordAudit(tx, ctx.actor, { action: "purchases.payment", entity: "payable", entityId: p.id, before: { balance: p.balance }, after: { balance, amount: input.amount, method: input.method, reference: input.reference || null } });
    return { balance };
  });
}

export async function getPayablePayments(ctx: ServiceContext, payableId: string) {
  requirePermission(ctx, "purchases.view");
  return db.select({ pp: payablePayments, userName: users.fullName }).from(payablePayments).leftJoin(users, eq(users.id, payablePayments.createdBy)).where(eq(payablePayments.payableId, payableId)).orderBy(asc(payablePayments.createdAt));
}

// ---------------------------------------------------------------- Sugerencias de compra

export type PurchaseSuggestion = {
  variantId: string;
  sku: string;
  name: string;
  variantName: string;
  onHand: number;
  onOrder: number;
  sold30: number;
  avgDaily: number;
  reorderPoint: number;
  target: number;
  suggested: number;
  supplierId: string | null;
  supplierName: string | null;
  leadTimeDays: number;
  lastCost: number | null;
};

/**
 * Sugerencias de compra para un almacén. Usa ventas de los últimos 30 días,
 * existencia, lo ya pedido, mínimos/máximos y el tiempo de entrega del
 * proveedor principal:
 *   punto de reorden = definido en el producto, o venta diaria × días de entrega
 *   objetivo         = máximo definido, o venta diaria × (entrega + cobertura)
 *   sugerido         = objetivo − existencia − pedido, si existencia + pedido ≤ punto de reorden
 */
export async function getPurchaseSuggestions(ctx: ServiceContext, warehouseId: string, coverDays = 14): Promise<PurchaseSuggestion[]> {
  requirePermission(ctx, "purchases.view");
  const company = requireCompany(ctx);
  const wh = await getAccessibleWarehouse(ctx, warehouseId);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await db
    .select({
      v: productVariants,
      p: products,
      allowsDecimals: unitsOfMeasure.allowsDecimals,
      onHand: stockBalances.onHand,
      sold30: sql<string>`coalesce((select -sum(l.quantity) from ${inventoryLedger} l where l.variant_id = ${productVariants.id} and l.warehouse_id = ${wh.id} and l.movement_type = 'sale_out' and l.created_at >= ${since}), 0) - coalesce((select sum(l.quantity) from ${inventoryLedger} l where l.variant_id = ${productVariants.id} and l.warehouse_id = ${wh.id} and l.movement_type = 'sale_cancel_in' and l.created_at >= ${since}), 0)`,
      onOrder: sql<string>`coalesce((select sum(pol.quantity_ordered - pol.quantity_received) from ${purchaseOrderLines} pol join ${purchaseOrders} po on po.id = pol.purchase_order_id where pol.variant_id = ${productVariants.id} and po.warehouse_id = ${wh.id} and po.status in ('sent','partial')), 0)`,
      supplierId: suppliers.id,
      supplierName: suppliers.name,
      leadTimeDays: suppliers.leadTimeDays,
      lastCost: productSuppliers.lastCost,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(unitsOfMeasure, eq(unitsOfMeasure.id, products.unitId))
    .leftJoin(stockBalances, and(eq(stockBalances.variantId, productVariants.id), eq(stockBalances.warehouseId, wh.id)))
    .leftJoin(productSuppliers, and(eq(productSuppliers.productId, products.id), eq(productSuppliers.isPrimary, true)))
    .leftJoin(suppliers, eq(suppliers.id, productSuppliers.supplierId))
    .where(and(eq(productVariants.companyId, company.id), isNull(productVariants.deactivatedAt), isNull(products.deactivatedAt), eq(products.trackStock, true)));
  const out: PurchaseSuggestion[] = [];
  for (const r of rows) {
    const onHand = Number(r.onHand ?? 0);
    const onOrder = Number(r.onOrder);
    const sold30 = Math.max(0, Number(r.sold30));
    const avgDaily = sold30 / 30;
    const lead = r.leadTimeDays ?? 7;
    const explicitRop = r.v.reorderPoint !== null ? Number(r.v.reorderPoint) : r.v.minStock !== null ? Number(r.v.minStock) : null;
    const reorderPoint = explicitRop ?? Math.ceil(avgDaily * lead);
    if (reorderPoint <= 0 && avgDaily === 0) continue;
    const target = Math.max(r.v.maxStock !== null ? Number(r.v.maxStock) : 0, avgDaily * (lead + coverDays), reorderPoint + 1);
    if (onHand + onOrder > reorderPoint) continue;
    let suggested = target - onHand - onOrder;
    suggested = r.allowsDecimals ? Math.round(suggested * 1000) / 1000 : Math.ceil(suggested);
    if (suggested <= 0) continue;
    out.push({
      variantId: r.v.id,
      sku: r.v.sku,
      name: r.p.name,
      variantName: r.v.variantName,
      onHand,
      onOrder,
      sold30,
      avgDaily: Math.round(avgDaily * 100) / 100,
      reorderPoint,
      target: Math.round(target * 1000) / 1000,
      suggested,
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      leadTimeDays: lead,
      lastCost: r.lastCost ?? r.v.cost,
    });
  }
  return out.sort((a, b) => (a.supplierName ?? "~").localeCompare(b.supplierName ?? "~") || a.name.localeCompare(b.name));
}

/** Crea órdenes en borrador (una por proveedor) a partir de sugerencias seleccionadas. */
export async function createOrdersFromSuggestions(ctx: ServiceContext, warehouseId: string, items: Array<{ variantId: string; quantity: number; supplierId: string; unitCost: number | string }>) {
  requirePermission(ctx, "purchases.create");
  const bySupplier = new Map<string, typeof items>();
  for (const it of items) {
    if (!it.supplierId) throw new ValidationError({ supplierId: ["Hay productos sin proveedor."] }, "Asigna un proveedor a todos los productos seleccionados.");
    (bySupplier.get(it.supplierId) ?? bySupplier.set(it.supplierId, []).get(it.supplierId)!).push(it);
  }
  const created = [];
  for (const [supplierId, lines] of bySupplier) {
    created.push(await createPurchaseOrder(ctx, { supplierId, warehouseId, lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, unitCost: typeof l.unitCost === "number" ? (l.unitCost / 100).toFixed(2) : l.unitCost })), notes: "Generada desde sugerencias de compra" }));
  }
  return created;
}

export function canSeeCosts(ctx: ServiceContext) {
  return hasPermission(ctx, "inventory.view_cost") || hasPermission(ctx, "catalog.view_cost");
}


/**
 * Costo sugerido para capturar compras: último costo con ese proveedor o, si
 * no hay, el costo del producto. Solo para quien puede ver costos.
 */
export async function costHints(ctx: ServiceContext, supplierId: string | null, variantIds: string[]): Promise<Record<string, number | null>> {
  requirePermission(ctx, "purchases.view");
  const company = requireCompany(ctx);
  if (!variantIds.length || !canSeeCosts(ctx)) return {};
  const rows = await db
    .select({ id: productVariants.id, cost: productVariants.cost, lastCost: productSuppliers.lastCost })
    .from(productVariants)
    .leftJoin(productSuppliers, and(eq(productSuppliers.productId, productVariants.productId), supplierId ? eq(productSuppliers.supplierId, supplierId) : sql`false`))
    .where(and(eq(productVariants.companyId, company.id), inArray(productVariants.id, variantIds.slice(0, 300))));
  return Object.fromEntries(rows.map((r) => [r.id, r.lastCost ?? r.cost ?? null]));
}
