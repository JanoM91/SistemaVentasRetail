import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/server/db";
import {
  branches,
  cashSessions,
  customerCreditMovements,
  customers,
  paymentMethods,
  payments,
  products,
  productVariants,
  RETURN_REASONS,
  REFUND_METHODS,
  saleLines,
  saleReturnLines,
  saleReturns,
  sales,
  storeCreditRedemptions,
  taxProfiles,
  users,
} from "@/server/db/schema";
import { recordAudit } from "@/server/audit";
import { hasPermission, requirePermission } from "@/server/authz/guard";
import { ConflictError, DomainError, NotFoundError, ValidationError } from "@/server/errors";
import { requireCompany, type ServiceContext } from "@/server/service-context";
import { parseOrThrow } from "@/server/validation";
import { computeLine, normalizeQty, roundHalfEven } from "@/lib/money";
import { postMovement } from "@/server/modules/inventory/ledger";
import { getDefaultWarehouse, variantLabel } from "@/server/modules/inventory/service";
import { computeSummary, getAccessibleRegister, getOpenSession } from "@/server/modules/cash/service";
import { verifyAuthorizer } from "@/server/modules/auth/service";
import { nextFolio } from "@/server/modules/sequences";
import type { Permission } from "@/server/authz/permissions";

export const REASON_LABELS: Record<(typeof RETURN_REASONS)[number], string> = {
  defective: "Producto defectuoso",
  wrong_item: "Producto equivocado",
  changed_mind: "Ya no lo quiere",
  expired: "Caducado",
  other: "Otro",
};
export const REFUND_LABELS: Record<(typeof REFUND_METHODS)[number], string> = {
  cash: "Efectivo",
  original: "Mismo medio de pago",
  customer_account: "Abono a la cuenta del cliente",
  store_credit: "Vale",
};

/** Política de devoluciones de la empresa (con valores por defecto). */
export function returnPolicy(company: { settings: { returns?: { maxDays?: number; allowWithoutTicket?: boolean; cashRefundNeedsAuthorization?: boolean } | null } | null }) {
  const r = company.settings?.returns ?? {};
  return { maxDays: r.maxDays ?? 30, allowWithoutTicket: r.allowWithoutTicket ?? true, cashRefundNeedsAuthorization: r.cashRefundNeedsAuthorization ?? true };
}

const daysSince = (d: Date) => Math.floor((Date.now() - d.getTime()) / 86_400_000);

// ---------------------------------------------------------------- Venta a devolver

/** Lo ya devuelto por línea de venta (cantidad e importes). */
async function returnedByLine(conn: Tx | typeof db, saleId: string) {
  const rows = await conn
    .select({
      saleLineId: saleReturnLines.saleLineId,
      qty: sql<string>`sum(${saleReturnLines.quantity})`,
      total: sql<number>`sum(${saleReturnLines.lineTotal})`.mapWith(Number),
      tax: sql<number>`sum(${saleReturnLines.taxAmount})`.mapWith(Number),
    })
    .from(saleReturnLines)
    .innerJoin(saleReturns, eq(saleReturns.id, saleReturnLines.returnId))
    .where(eq(saleReturns.saleId, saleId))
    .groupBy(saleReturnLines.saleLineId);
  return new Map(rows.map((r) => [r.saleLineId!, { qty: Number(r.qty), total: r.total, tax: r.tax }]));
}

/** Venta lista para devolver: líneas con lo que aún se puede devolver, pagos y política. */
export async function getReturnableSale(ctx: ServiceContext, folioOrId: string) {
  requirePermission(ctx, "returns.create");
  const company = requireCompany(ctx);
  const key = folioOrId.trim();
  const isId = /^[0-9a-f-]{36}$/i.test(key);
  const where: SQL[] = [eq(sales.companyId, company.id), isId ? eq(sales.id, key) : sql`upper(${sales.folio}) = ${key.toUpperCase()}`];
  if (!ctx.permissions.has("branches.manage")) where.push(inArray(sales.branchId, ctx.branches.map((b) => b.id).concat(["00000000-0000-0000-0000-000000000000"])));
  if (!isId && ctx.branch) where.push(eq(sales.branchId, ctx.branch.id));
  const [sale] = await db.select().from(sales).where(and(...where)).orderBy(desc(sales.soldAt)).limit(1);
  if (!sale) throw new NotFoundError("La venta");
  if (sale.status !== "completed") throw new ConflictError(`La venta ${sale.folio} está cancelada.`);
  const [lines, pays, returned, prior] = await Promise.all([
    db.select().from(saleLines).where(eq(saleLines.saleId, sale.id)).orderBy(saleLines.lineNo),
    db.select({ p: payments, name: paymentMethods.name }).from(payments).innerJoin(paymentMethods, eq(paymentMethods.id, payments.paymentMethodId)).where(eq(payments.saleId, sale.id)),
    returnedByLine(db, sale.id),
    db.select({ folio: saleReturns.folio, total: saleReturns.total, createdAt: saleReturns.createdAt }).from(saleReturns).where(eq(saleReturns.saleId, sale.id)).orderBy(saleReturns.createdAt),
  ]);
  const policy = returnPolicy(company);
  const age = daysSince(sale.soldAt);
  return {
    sale: { id: sale.id, folio: sale.folio, soldAt: sale.soldAt, total: sale.total, customerId: sale.customerId, customerName: sale.customerName },
    lines: lines.map((l) => {
      const r = returned.get(l.id);
      const q = Number(l.quantity);
      return {
        saleLineId: l.id,
        variantId: l.variantId,
        sku: l.sku,
        description: l.description,
        quantity: q,
        returnedQty: r?.qty ?? 0,
        returnableQty: normalizeQty(q - (r?.qty ?? 0)),
        lineTotal: l.lineTotal,
        returnableAmount: l.lineTotal - (r?.total ?? 0),
        unitPaid: roundHalfEven(l.lineTotal / q),
      };
    }),
    payments: pays.map(({ p, name }) => ({ methodId: p.paymentMethodId, name, kind: p.kind, amount: p.amount })),
    priorReturns: prior,
    ageDays: age,
    outOfPolicy: age > policy.maxDays,
    policy,
  };
}

// ---------------------------------------------------------------- Registro

export const returnSchema = z.object({
  id: z.string().uuid(),
  cashRegisterId: z.string().uuid(),
  saleId: z.string().uuid().optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
  lines: z
    .array(z.object({ saleLineId: z.string().uuid().optional().nullable(), variantId: z.string().uuid(), quantity: z.number().positive().max(100_000), restock: z.boolean().default(true) }))
    .min(1, "Elige qué se devuelve")
    .max(200),
  reasonCode: z.enum(RETURN_REASONS),
  reason: z.string().trim().min(3, "Describe el motivo").max(300),
  refundMethod: z.enum(REFUND_METHODS),
  refundPaymentMethodId: z.string().uuid().optional().nullable(),
  refundReference: z.string().trim().max(80).optional().or(z.literal("")),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
  authorization: z.object({ username: z.string(), password: z.string() }).optional(),
});

type Prepared = { saleLineId: string | null; variantId: string; sku: string; description: string; quantity: number; net: number; tax: number; total: number; unitCost: number | null; restock: boolean; label: string };

/**
 * Registra una devolución. Con ticket reembolsa lo efectivamente cobrado por
 * línea (proporcional, con descuentos); sin ticket se valúa a precio vigente
 * y solo se entrega vale. Lo devuelto regresa al inventario al costo de la
 * venta o se registra como merma. Idempotente por `id`.
 */
export async function createReturn(ctx: ServiceContext, raw: unknown) {
  requirePermission(ctx, "returns.create");
  const company = requireCompany(ctx);
  const input = parseOrThrow(returnSchema, raw);
  const [existing] = await db.select().from(saleReturns).where(and(eq(saleReturns.id, input.id), eq(saleReturns.tenantId, ctx.tenantId))).limit(1);
  if (existing) return { ret: existing, duplicate: true as const };

  const policy = returnPolicy(company);
  const reg = await getAccessibleRegister(ctx, input.cashRegisterId);
  const session = await getOpenSession(db, reg.id);
  if (!session) throw new ConflictError(`${reg.name} no tiene un turno abierto. Abre la caja para registrar devoluciones.`);
  const warehouse = await getDefaultWarehouse(db, reg.branchId);
  const needs: Array<{ permission: Permission; why: string }> = [];

  let sale: typeof sales.$inferSelect | null = null;
  let prepared: Prepared[];
  if (input.saleId) {
    [sale] = await db.select().from(sales).where(and(eq(sales.id, input.saleId), eq(sales.companyId, company.id))).limit(1);
    if (!sale) throw new NotFoundError("La venta");
    if (!ctx.permissions.has("branches.manage") && !ctx.branches.some((b) => b.id === sale!.branchId)) throw new NotFoundError("La venta");
    if (sale.status !== "completed") throw new ConflictError(`La venta ${sale.folio} está cancelada.`);
    const age = daysSince(sale.soldAt);
    if (age > policy.maxDays) needs.push({ permission: "returns.authorize", why: `la venta tiene ${age} días (límite ${policy.maxDays})` });
    prepared = await prepareTicketLines(db, sale, input.lines);
  } else {
    if (!policy.allowWithoutTicket) throw new ConflictError("Esta empresa no acepta devoluciones sin ticket.");
    if (input.refundMethod !== "store_credit") throw new ValidationError({ refundMethod: ["Sin ticket solo se entrega vale."] }, "Las devoluciones sin ticket solo se reembolsan con vale.");
    if (!hasPermission(ctx, "returns.no_ticket")) needs.push({ permission: "returns.no_ticket", why: "es una devolución sin ticket" });
    prepared = await prepareNoTicketLines(company.id, input.lines);
  }
  const total = prepared.reduce((a, l) => a + l.total, 0);
  if (total <= 0) throw new ValidationError({ lines: ["Importe en cero."] }, "La devolución no tiene importe.");

  // --- Forma de reembolso
  let refundMethodId: string | null = null;
  let customerId = sale?.customerId ?? input.customerId ?? null;
  if (input.refundMethod === "cash") {
    if (policy.cashRefundNeedsAuthorization && !hasPermission(ctx, "returns.authorize")) needs.push({ permission: "returns.authorize", why: "el reembolso es en efectivo" });
    const summary = await computeSummary(db, session);
    if (summary.expectedCash < total) throw new ConflictError(`No hay suficiente efectivo en caja (${(summary.expectedCash / 100).toFixed(2)}). Elige otra forma de reembolso.`);
  } else if (input.refundMethod === "original") {
    if (!sale) throw new ValidationError({ refundMethod: ["Requiere ticket."] }, "Para reembolsar al medio original se necesita el ticket.");
    const paid = await db.select().from(payments).where(and(eq(payments.saleId, sale.id), eq(payments.paymentMethodId, input.refundPaymentMethodId ?? "00000000-0000-0000-0000-000000000000")));
    const usable = paid.filter((p) => !["cash", "customer_credit", "prepaid"].includes(p.kind));
    if (!usable.length) throw new ValidationError({ refundPaymentMethodId: ["Ese medio no se usó en la venta."] }, "Elige un medio de pago electrónico que se haya usado en la venta.");
    const [prev] = await db.select({ s: sql<number>`coalesce(sum(${saleReturns.total}),0)`.mapWith(Number) }).from(saleReturns).where(and(eq(saleReturns.saleId, sale.id), eq(saleReturns.refundMethod, "original"), eq(saleReturns.refundPaymentMethodId, input.refundPaymentMethodId!)));
    const max = usable.reduce((a, p) => a + p.amount, 0) - prev.s;
    if (total > max) throw new ValidationError({ refundPaymentMethodId: [`Máximo ${(max / 100).toFixed(2)}.`] }, `Con ese medio solo se pueden reembolsar ${(max / 100).toFixed(2)}.`);
    refundMethodId = input.refundPaymentMethodId!;
  } else if (input.refundMethod === "customer_account") {
    if (!sale?.customerId) throw new ValidationError({ refundMethod: ["La venta no tiene cliente."] }, "La venta no tiene cliente registrado.");
    const [c] = await db.select().from(customers).where(eq(customers.id, sale.customerId)).limit(1);
    if (c.creditBalance < total) throw new ValidationError({ refundMethod: [`Saldo ${(c.creditBalance / 100).toFixed(2)}.`] }, `El saldo del cliente (${(c.creditBalance / 100).toFixed(2)}) es menor a la devolución; elige otra forma.`);
    customerId = c.id;
  }

  // --- Autorización
  let authorizedBy: string | null = null;
  if (needs.length) {
    if (!input.authorization) throw new DomainError("return_authorization_required", `Requiere autorización: ${needs.map((n) => n.why).join("; ")}.`, 403);
    for (const perm of [...new Set(needs.map((n) => n.permission))]) {
      authorizedBy = (await verifyAuthorizer({ tenantId: ctx.tenantId, companyId: company.id, ...input.authorization, permission: perm })).authorizerId;
    }
  }

  try {
    return await db.transaction(async (tx) => {
      if (sale) {
        // Bloquea la venta: dos devoluciones simultáneas no pueden pasar de lo vendido.
        const [locked] = await tx.select().from(sales).where(eq(sales.id, sale.id)).for("update");
        if (locked.status !== "completed") throw new ConflictError("La venta se canceló mientras registrabas la devolución.");
        prepared = await prepareTicketLines(tx, locked, input.lines);
        if (prepared.reduce((a, l) => a + l.total, 0) !== total) throw new ConflictError("Otra devolución de esta venta se registró al mismo tiempo. Revisa y vuelve a intentar.");
      }
      const folio = await nextFolio(tx, { tenantId: ctx.tenantId, companyId: company.id, branchId: reg.branchId, documentType: "return" });
      const costTotal = prepared.every((l) => l.unitCost !== null) ? prepared.reduce((a, l) => a + roundHalfEven((l.unitCost as number) * l.quantity), 0) : null;
      const [ret] = await tx
        .insert(saleReturns)
        .values({
          id: input.id,
          tenantId: ctx.tenantId,
          companyId: company.id,
          branchId: reg.branchId,
          warehouseId: warehouse.id,
          cashRegisterId: reg.id,
          cashSessionId: session.id,
          saleId: sale?.id ?? null,
          customerId,
          series: folio.series,
          number: folio.number,
          folio: folio.folio,
          reasonCode: input.reasonCode,
          reason: input.reason,
          subtotal: prepared.reduce((a, l) => a + l.net, 0),
          taxTotal: prepared.reduce((a, l) => a + l.tax, 0),
          total,
          costTotal,
          refundMethod: input.refundMethod,
          refundPaymentMethodId: refundMethodId,
          refundReference: input.refundReference || null,
          storeCreditBalance: input.refundMethod === "store_credit" ? total : 0,
          notes: input.notes || null,
          createdBy: ctx.userId,
          authorizedBy,
        })
        .returning();
      for (const l of prepared) {
        let ledgerId: string | null = null;
        if (l.restock) {
          const mv = await postMovement(tx, {
            tenantId: ctx.tenantId,
            companyId: company.id,
            branchId: reg.branchId,
            warehouseId: warehouse.id,
            variantId: l.variantId,
            movementType: "return_in",
            quantity: l.quantity,
            unitCost: l.unitCost,
            allowNegative: true,
            referenceType: "sale_return",
            referenceId: ret.id,
            reason: `Devolución ${ret.folio}${sale ? ` de ${sale.folio}` : " sin ticket"}`,
            createdBy: ctx.userId,
            label: l.label,
          });
          ledgerId = mv.ledger.id;
        }
        await tx.insert(saleReturnLines).values({ tenantId: ctx.tenantId, returnId: ret.id, saleLineId: l.saleLineId, variantId: l.variantId, sku: l.sku, description: l.description, quantity: String(l.quantity), netAmount: l.net, taxAmount: l.tax, lineTotal: l.total, unitCost: l.unitCost, restock: l.restock, ledgerId });
      }
      if (sale?.customerId) {
        await tx.update(customers).set({ purchasesTotal: sql`greatest(${customers.purchasesTotal} - ${total}, 0)` }).where(eq(customers.id, sale.customerId));
      }
      if (input.refundMethod === "customer_account" && customerId) {
        const [c] = await tx.select().from(customers).where(eq(customers.id, customerId)).for("update");
        if (c.creditBalance < total) throw new ConflictError("El saldo del cliente cambió; elige otra forma de reembolso.");
        const balance = c.creditBalance - total;
        await tx.insert(customerCreditMovements).values({ tenantId: ctx.tenantId, companyId: company.id, customerId: c.id, branchId: reg.branchId, kind: "return", amount: -total, balanceAfter: balance, folio: ret.folio, notes: `Devolución de ${sale!.folio}`, createdBy: ctx.userId, authorizedBy });
        await tx.update(customers).set({ creditBalance: balance }).where(eq(customers.id, c.id));
      }
      await recordAudit(tx, { ...ctx.actor, branchId: reg.branchId, authorizedByUserId: authorizedBy }, {
        action: "returns.create",
        entity: "sale_return",
        entityId: ret.id,
        reason: `${REASON_LABELS[input.reasonCode]}: ${input.reason}`,
        after: { folio: ret.folio, sale: sale?.folio ?? null, total, refund: input.refundMethod, lines: prepared.map((l) => ({ sku: l.sku, qty: l.quantity, total: l.total, restock: l.restock })) },
      });
      return { ret, duplicate: false as const };
    });
  } catch (err) {
    const e = ((err as { cause?: unknown }).cause ?? err) as { code?: string; constraint?: string };
    if (e?.code === "23505" && e.constraint === "sale_returns_pkey") {
      const [dup] = await db.select().from(saleReturns).where(eq(saleReturns.id, input.id)).limit(1);
      if (dup) return { ret: dup, duplicate: true as const };
    }
    throw err;
  }
}

async function prepareTicketLines(conn: Tx | typeof db, sale: typeof sales.$inferSelect, lines: z.infer<typeof returnSchema>["lines"]): Promise<Prepared[]> {
  const saleLineRows = await conn.select().from(saleLines).where(eq(saleLines.saleId, sale.id));
  const returned = await returnedByLine(conn, sale.id);
  const seen = new Set<string>();
  return lines.map((l, i) => {
    const sl = saleLineRows.find((x) => x.id === l.saleLineId);
    if (!sl || sl.variantId !== l.variantId) throw new ValidationError({ [`lines.${i}`]: ["No está en la venta."] }, "Un producto no pertenece a la venta.");
    if (seen.has(sl.id)) throw new ValidationError({ [`lines.${i}`]: ["Repetido."] }, "Un producto aparece dos veces.");
    seen.add(sl.id);
    const sold = Number(sl.quantity);
    const prev = returned.get(sl.id);
    const remainingQty = normalizeQty(sold - (prev?.qty ?? 0));
    const q = normalizeQty(l.quantity);
    if (q > remainingQty + 1e-9) throw new ValidationError({ [`lines.${i}.quantity`]: [`Máximo ${remainingQty}.`] }, `${sl.description}: solo se pueden devolver ${remainingQty}.`);
    // Lo último por devolver toma el resto exacto para que la suma cuadre al centavo.
    const last = Math.abs(q - remainingQty) < 1e-9;
    const total = last ? sl.lineTotal - (prev?.total ?? 0) : roundHalfEven((sl.lineTotal * q) / sold);
    const tax = last ? sl.taxAmount - (prev?.tax ?? 0) : roundHalfEven((sl.taxAmount * q) / sold);
    return { saleLineId: sl.id, variantId: sl.variantId, sku: sl.sku, description: sl.description, quantity: q, net: total - tax, tax, total, unitCost: sl.unitCost, restock: l.restock, label: sl.description };
  });
}

async function prepareNoTicketLines(companyId: string, lines: z.infer<typeof returnSchema>["lines"]): Promise<Prepared[]> {
  const ids = [...new Set(lines.map((l) => l.variantId))];
  const rows = await db
    .select({ v: productVariants, p: products, tax: taxProfiles })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(taxProfiles, eq(taxProfiles.id, products.taxProfileId))
    .where(and(eq(productVariants.companyId, companyId), inArray(productVariants.id, ids)));
  if (ids.length !== lines.length) throw new ValidationError({ lines: ["Producto repetido."] }, "Un producto aparece dos veces.");
  return lines.map((l) => {
    const r = rows.find((x) => x.v.id === l.variantId);
    if (!r) throw new NotFoundError("Algún producto");
    const q = normalizeQty(l.quantity);
    const a = computeLine({ unitPrice: r.v.price, quantity: q, discount: 0, taxRate: Number(r.tax.rate), taxIncluded: r.tax.isIncludedInPrice });
    const label = variantLabel(r.p, r.v);
    return { saleLineId: null, variantId: r.v.id, sku: r.v.sku, description: r.p.name + (r.v.variantName ? ` ${r.v.variantName}` : ""), quantity: q, net: a.net, tax: a.tax, total: a.total, unitCost: r.v.cost, restock: l.restock, label };
  });
}

// ---------------------------------------------------------------- Vales

export async function getStoreCredit(ctx: ServiceContext, folio: string) {
  requirePermission(ctx, "pos.sell");
  const company = requireCompany(ctx);
  const [r] = await db
    .select({ id: saleReturns.id, folio: saleReturns.folio, balance: saleReturns.storeCreditBalance, total: saleReturns.total, createdAt: saleReturns.createdAt, customerName: customers.name })
    .from(saleReturns)
    .leftJoin(customers, eq(customers.id, saleReturns.customerId))
    .where(and(eq(saleReturns.companyId, company.id), eq(saleReturns.refundMethod, "store_credit"), sql`upper(${saleReturns.folio}) = ${folio.trim().toUpperCase()}`))
    .limit(1);
  if (!r) throw new NotFoundError("El vale");
  return r;
}

/** Canjea vales dentro de la transacción de una venta (pagos de tipo `prepaid` con el folio como referencia). */
export async function redeemStoreCredits(tx: Tx, ctx: ServiceContext, saleId: string, items: Array<{ folio: string; amount: number }>) {
  const company = requireCompany(ctx);
  for (const it of items) {
    const [r] = await tx
      .select()
      .from(saleReturns)
      .where(and(eq(saleReturns.companyId, company.id), eq(saleReturns.refundMethod, "store_credit"), sql`upper(${saleReturns.folio}) = ${it.folio.trim().toUpperCase()}`))
      .for("update");
    if (!r) throw new ValidationError({ payments: [`El vale ${it.folio} no existe.`] }, `El vale ${it.folio} no existe.`);
    if (r.storeCreditBalance < it.amount) throw new ConflictError(`El vale ${r.folio} solo tiene ${(r.storeCreditBalance / 100).toFixed(2)} disponibles.`);
    await tx.update(saleReturns).set({ storeCreditBalance: r.storeCreditBalance - it.amount }).where(eq(saleReturns.id, r.id));
    await tx.insert(storeCreditRedemptions).values({ tenantId: ctx.tenantId, companyId: company.id, returnId: r.id, saleId, amount: it.amount });
  }
}

/** Al cancelar una venta, los vales canjeados recuperan su saldo. */
export async function reverseRedemptions(tx: Tx, saleId: string) {
  const rows = await tx.select().from(storeCreditRedemptions).where(and(eq(storeCreditRedemptions.saleId, saleId), eq(storeCreditRedemptions.status, "applied")));
  for (const r of rows) {
    await tx.update(saleReturns).set({ storeCreditBalance: sql`${saleReturns.storeCreditBalance} + ${r.amount}` }).where(eq(saleReturns.id, r.returnId));
    await tx.update(storeCreditRedemptions).set({ status: "reversed" }).where(eq(storeCreditRedemptions.id, r.id));
  }
}

// ---------------------------------------------------------------- Consultas

export async function listReturns(ctx: ServiceContext, opts: { sessionId?: string | null; saleId?: string | null; limit?: number } = {}) {
  requirePermission(ctx, "returns.create");
  const company = requireCompany(ctx);
  const where: SQL[] = [eq(saleReturns.companyId, company.id)];
  if (!ctx.permissions.has("branches.manage")) where.push(inArray(saleReturns.branchId, ctx.branches.map((b) => b.id).concat(["00000000-0000-0000-0000-000000000000"])));
  if (opts.sessionId) where.push(eq(saleReturns.cashSessionId, opts.sessionId));
  if (opts.saleId) where.push(eq(saleReturns.saleId, opts.saleId));
  return db
    .select({ r: saleReturns, saleFolio: sales.folio, branchName: branches.name, userName: users.fullName, customerName: customers.name })
    .from(saleReturns)
    .innerJoin(branches, eq(branches.id, saleReturns.branchId))
    .innerJoin(users, eq(users.id, saleReturns.createdBy))
    .leftJoin(sales, eq(sales.id, saleReturns.saleId))
    .leftJoin(customers, eq(customers.id, saleReturns.customerId))
    .where(and(...where))
    .orderBy(desc(saleReturns.createdAt))
    .limit(Math.min(opts.limit ?? 200, 500));
}

export async function getReturn(ctx: ServiceContext, id: string) {
  const [row] = await listReturnsById(ctx, id);
  if (!row) throw new NotFoundError("La devolución");
  const [lines, redemptions, method, authorizer] = await Promise.all([
    db.select().from(saleReturnLines).where(eq(saleReturnLines.returnId, id)),
    db.select({ x: storeCreditRedemptions, saleFolio: sales.folio }).from(storeCreditRedemptions).innerJoin(sales, eq(sales.id, storeCreditRedemptions.saleId)).where(eq(storeCreditRedemptions.returnId, id)).orderBy(storeCreditRedemptions.createdAt),
    row.r.refundPaymentMethodId ? db.select({ name: paymentMethods.name }).from(paymentMethods).where(eq(paymentMethods.id, row.r.refundPaymentMethodId)).then((x) => x[0]?.name ?? null) : Promise.resolve(null),
    row.r.authorizedBy ? db.select({ n: users.fullName }).from(users).where(eq(users.id, row.r.authorizedBy)).then((x) => x[0]?.n ?? null) : Promise.resolve(null),
  ]);
  return { ...row, lines, redemptions, refundMethodName: method, authorizerName: authorizer, showCost: hasPermission(ctx, "reports.view_profit") };
}

async function listReturnsById(ctx: ServiceContext, id: string) {
  const all = await listReturnsWhere(ctx, eq(saleReturns.id, id));
  return all;
}
async function listReturnsWhere(ctx: ServiceContext, cond: SQL) {
  requirePermission(ctx, "returns.create");
  const company = requireCompany(ctx);
  const where: SQL[] = [eq(saleReturns.companyId, company.id), cond];
  if (!ctx.permissions.has("branches.manage")) where.push(inArray(saleReturns.branchId, ctx.branches.map((b) => b.id).concat(["00000000-0000-0000-0000-000000000000"])));
  return db
    .select({ r: saleReturns, saleFolio: sales.folio, branchName: branches.name, userName: users.fullName, customerName: customers.name, sessionStatus: cashSessions.status })
    .from(saleReturns)
    .innerJoin(branches, eq(branches.id, saleReturns.branchId))
    .innerJoin(users, eq(users.id, saleReturns.createdBy))
    .innerJoin(cashSessions, eq(cashSessions.id, saleReturns.cashSessionId))
    .leftJoin(sales, eq(sales.id, saleReturns.saleId))
    .leftJoin(customers, eq(customers.id, saleReturns.customerId))
    .where(and(...where))
    .limit(1);
}
