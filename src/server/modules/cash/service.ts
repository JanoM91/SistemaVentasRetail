import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/server/db";
import {
  cashMovements,
  customerCreditMovements,
  cashRegisters,
  cashSessions,
  paymentMethods,
  payments,
  sales,
  users,
  type CashSummary,
  type Denominations,
} from "@/server/db/schema";
import { recordAudit } from "@/server/audit";
import { hasPermission, requirePermission } from "@/server/authz/guard";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { requireCompany, type ServiceContext } from "@/server/service-context";
import { parseOrThrow } from "@/server/validation";
import { parseMoney } from "@/lib/money";
import { verifyAuthorizer } from "@/server/modules/auth/service";

export async function getAccessibleRegister(ctx: ServiceContext, registerId: string, conn: DbOrTx = db) {
  const company = requireCompany(ctx);
  const [reg] = await conn
    .select()
    .from(cashRegisters)
    .where(and(eq(cashRegisters.id, registerId), eq(cashRegisters.companyId, company.id)))
    .limit(1);
  if (!reg || reg.deactivatedAt) throw new NotFoundError("La caja");
  const canSeeAll = ctx.permissions.has("branches.manage");
  if (!canSeeAll && !ctx.branches.some((b) => b.id === reg.branchId)) throw new NotFoundError("La caja");
  return reg;
}

export async function getOpenSession(conn: DbOrTx, registerId: string) {
  const [s] = await conn
    .select()
    .from(cashSessions)
    .where(and(eq(cashSessions.cashRegisterId, registerId), eq(cashSessions.status, "open")))
    .limit(1);
  return s ?? null;
}

/** Cajas de la sucursal activa con su turno abierto (si lo hay). */
export async function listRegistersWithStatus(ctx: ServiceContext, branchId?: string) {
  const company = requireCompany(ctx);
  const target = branchId ?? ctx.branch?.id;
  if (!target) return [];
  if (!ctx.permissions.has("branches.manage") && !ctx.branches.some((b) => b.id === target)) throw new NotFoundError("La sucursal");
  const rows = await db
    .select({ register: cashRegisters, session: cashSessions, openedByName: users.fullName })
    .from(cashRegisters)
    .leftJoin(cashSessions, and(eq(cashSessions.cashRegisterId, cashRegisters.id), eq(cashSessions.status, "open")))
    .leftJoin(users, eq(users.id, cashSessions.openedBy))
    .where(and(eq(cashRegisters.companyId, company.id), eq(cashRegisters.branchId, target), sql`${cashRegisters.deactivatedAt} is null`))
    .orderBy(cashRegisters.code);
  return rows;
}

// ---------------------------------------------------------------- Apertura

export const openSchema = z.object({
  cashRegisterId: z.string().uuid("Elige una caja"),
  openingAmount: z.union([z.string(), z.number()]).transform((v, c) => {
    const cents = parseMoney(v === "" ? "0" : v);
    if (cents === null || cents < 0) {
      c.addIssue({ code: "custom", message: "Importe inválido" });
      return z.NEVER;
    }
    return cents;
  }),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
});

export async function openSession(ctx: ServiceContext, raw: unknown) {
  requirePermission(ctx, "cash.open");
  const input = parseOrThrow(openSchema, raw);
  const reg = await getAccessibleRegister(ctx, input.cashRegisterId);
  if (await getOpenSession(db, reg.id)) throw new ConflictError(`${reg.name} ya tiene un turno abierto.`);
  return db.transaction(async (tx) => {
    const [s] = await tx
      .insert(cashSessions)
      .values({
        tenantId: ctx.tenantId,
        companyId: reg.companyId,
        branchId: reg.branchId,
        cashRegisterId: reg.id,
        openedBy: ctx.userId,
        openingAmount: input.openingAmount,
        notes: input.notes || null,
      })
      .returning();
    await recordAudit(tx, ctx.actor, {
      action: "cash.open",
      entity: "cash_session",
      entityId: s.id,
      branchId: reg.branchId,
      after: { register: reg.code, openingAmount: s.openingAmount },
    });
    return s;
  });
}

// ---------------------------------------------------------------- Resumen (corte X)

export async function computeSummary(conn: DbOrTx, session: typeof cashSessions.$inferSelect): Promise<CashSummary> {
  const saleRows = await conn
    .select({ status: sales.status, n: sql<number>`count(*)`.mapWith(Number), sum: sql<number>`coalesce(sum(${sales.total}),0)`.mapWith(Number) })
    .from(sales)
    .where(eq(sales.cashSessionId, session.id))
    .groupBy(sales.status);
  let salesCount = 0, salesTotal = 0, cancelledCount = 0, cancelledTotal = 0;
  for (const r of saleRows) {
    if (r.status === "completed") { salesCount += r.n; salesTotal += r.sum; }
    else { cancelledCount += r.n; cancelledTotal += r.sum; }
  }
  const pay = await conn
    .select({
      methodId: payments.paymentMethodId,
      name: paymentMethods.name,
      kind: payments.kind,
      amount: sql<number>`coalesce(sum(${payments.amount}),0)`.mapWith(Number),
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(payments)
    .innerJoin(sales, eq(sales.id, payments.saleId))
    .innerJoin(paymentMethods, eq(paymentMethods.id, payments.paymentMethodId))
    .where(and(eq(sales.cashSessionId, session.id), eq(sales.status, "completed"), eq(payments.status, "approved")))
    .groupBy(payments.paymentMethodId, paymentMethods.name, payments.kind)
    .orderBy(paymentMethods.name);
  const mov = await conn
    .select({ kind: cashMovements.kind, sum: sql<number>`coalesce(sum(${cashMovements.amount}),0)`.mapWith(Number) })
    .from(cashMovements)
    .where(eq(cashMovements.cashSessionId, session.id))
    .groupBy(cashMovements.kind);
  const deposits = mov.find((m) => m.kind === "deposit")?.sum ?? 0;
  const withdrawals = mov.find((m) => m.kind === "withdrawal")?.sum ?? 0;
  const cashSales = pay.filter((p) => p.kind === "cash").reduce((a, p) => a + p.amount, 0);
  // Abonos de clientes cobrados en este turno.
  const abonos = await conn
    .select({
      methodId: paymentMethods.id,
      name: paymentMethods.name,
      kind: paymentMethods.kind,
      amount: sql<number>`coalesce(-sum(${customerCreditMovements.amount}),0)`.mapWith(Number),
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(customerCreditMovements)
    .innerJoin(paymentMethods, eq(paymentMethods.id, customerCreditMovements.paymentMethodId))
    .where(and(eq(customerCreditMovements.cashSessionId, session.id), eq(customerCreditMovements.kind, "payment")))
    .groupBy(paymentMethods.id, paymentMethods.name, paymentMethods.kind)
    .orderBy(paymentMethods.name);
  const cashCreditPayments = abonos.filter((p) => p.kind === "cash").reduce((a, p) => a + p.amount, 0);
  return {
    salesCount,
    salesTotal,
    cancelledCount,
    cancelledTotal,
    byMethod: pay,
    cashSales,
    creditPayments: abonos,
    cashCreditPayments,
    deposits,
    withdrawals,
    expectedCash: session.openingAmount + cashSales + cashCreditPayments + deposits - withdrawals,
  };
}

export async function getSessionDetail(ctx: ServiceContext, sessionId: string) {
  requirePermission(ctx, "cash.open");
  const company = requireCompany(ctx);
  const [row] = await db
    .select({ session: cashSessions, register: cashRegisters })
    .from(cashSessions)
    .innerJoin(cashRegisters, eq(cashRegisters.id, cashSessions.cashRegisterId))
    .where(and(eq(cashSessions.id, sessionId), eq(cashSessions.companyId, company.id)))
    .limit(1);
  if (!row) throw new NotFoundError("El turno");
  if (!ctx.permissions.has("branches.manage") && !ctx.branches.some((b) => b.id === row.session.branchId)) throw new NotFoundError("El turno");
  const summary = row.session.status === "closed" && row.session.closingSummary ? row.session.closingSummary : await computeSummary(db, row.session);
  const movements = await db
    .select({ m: cashMovements, userName: users.fullName })
    .from(cashMovements)
    .leftJoin(users, eq(users.id, cashMovements.createdBy))
    .where(eq(cashMovements.cashSessionId, sessionId))
    .orderBy(cashMovements.createdAt);
  const names = await db
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(inArray(users.id, [row.session.openedBy, row.session.closedBy].filter(Boolean) as string[]));
  const nameOf = (id: string | null) => names.find((n) => n.id === id)?.fullName ?? null;
  return {
    ...row,
    summary,
    movements,
    openedByName: nameOf(row.session.openedBy),
    closedByName: nameOf(row.session.closedBy),
    canSeeDifferences: hasPermission(ctx, "cash.view_differences") || row.session.closedBy === ctx.userId,
  };
}

// ---------------------------------------------------------------- Retiros y depósitos

export const movementSchema = z.object({
  cashSessionId: z.string().uuid(),
  kind: z.enum(["withdrawal", "deposit"]),
  amount: z.union([z.string(), z.number()]).transform((v, c) => {
    const cents = parseMoney(v);
    if (cents === null || cents <= 0) {
      c.addIssue({ code: "custom", message: "Debe ser mayor a cero" });
      return z.NEVER;
    }
    return cents;
  }),
  reason: z.string().trim().min(3, "Explica el motivo").max(300),
  authorizerUsername: z.string().optional(),
  authorizerPassword: z.string().optional(),
});

export async function addCashMovement(ctx: ServiceContext, raw: unknown) {
  const input = parseOrThrow(movementSchema, raw);
  const perm = input.kind === "withdrawal" ? "cash.withdraw" : "cash.deposit";
  const company = requireCompany(ctx);
  let authorizedBy: string | null = null;
  if (!hasPermission(ctx, perm)) {
    if (!input.authorizerUsername || !input.authorizerPassword) throw new ForbiddenError(perm, "Esta acción requiere autorización de un gerente.");
    authorizedBy = (await verifyAuthorizer({ tenantId: ctx.tenantId, companyId: company.id, username: input.authorizerUsername, password: input.authorizerPassword, permission: perm })).authorizerId;
  }
  const [session] = await db.select().from(cashSessions).where(and(eq(cashSessions.id, input.cashSessionId), eq(cashSessions.companyId, company.id))).limit(1);
  if (!session) throw new NotFoundError("El turno");
  await getAccessibleRegister(ctx, session.cashRegisterId);
  if (session.status !== "open") throw new ConflictError("El turno ya está cerrado.");
  if (input.kind === "withdrawal") {
    const summary = await computeSummary(db, session);
    if (input.amount > summary.expectedCash) {
      throw new ValidationError({ amount: [`No hay suficiente efectivo en caja (esperado: ${(summary.expectedCash / 100).toFixed(2)}).`] });
    }
  }
  return db.transaction(async (tx) => {
    const [m] = await tx
      .insert(cashMovements)
      .values({ tenantId: ctx.tenantId, companyId: company.id, cashSessionId: session.id, kind: input.kind, amount: input.amount, reason: input.reason, createdBy: ctx.userId, authorizedBy })
      .returning();
    await recordAudit(tx, { ...ctx.actor, authorizedByUserId: authorizedBy }, {
      action: input.kind === "withdrawal" ? "cash.withdraw" : "cash.deposit",
      entity: "cash_session",
      entityId: session.id,
      branchId: session.branchId,
      reason: input.reason,
      after: { amount: m.amount },
    });
    return m;
  });
}

// ---------------------------------------------------------------- Cierre (corte Z)

export const closeSchema = z.object({
  cashSessionId: z.string().uuid(),
  /** Conteo por denominación (valor en centavos → piezas). Si se omite, se usa countedCash. */
  denominations: z.record(z.string(), z.coerce.number().int().min(0)).optional(),
  countedCash: z.union([z.string(), z.number()]).optional(),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export function sumDenominations(d: Denominations): number {
  return Object.entries(d).reduce((acc, [value, pieces]) => acc + Number(value) * pieces, 0);
}

export async function closeSession(ctx: ServiceContext, raw: unknown) {
  requirePermission(ctx, "cash.close");
  const input = parseOrThrow(closeSchema, raw);
  const company = requireCompany(ctx);
  const [session] = await db.select().from(cashSessions).where(and(eq(cashSessions.id, input.cashSessionId), eq(cashSessions.companyId, company.id))).limit(1);
  if (!session) throw new NotFoundError("El turno");
  await getAccessibleRegister(ctx, session.cashRegisterId);
  if (session.status !== "open") throw new ConflictError("El turno ya está cerrado.");
  if (session.openedBy !== ctx.userId) requirePermission(ctx, "cash.close_any");
  let counted: number | null = null;
  const denominations = input.denominations && Object.keys(input.denominations).length ? input.denominations : null;
  if (denominations) counted = sumDenominations(denominations);
  else if (input.countedCash !== undefined && input.countedCash !== "") counted = parseMoney(input.countedCash);
  if (counted === null || counted < 0) throw new ValidationError({ countedCash: ["Captura el efectivo contado."] });

  return db.transaction(async (tx) => {
    // Bloquea el turno para que ninguna venta entre mientras se cierra.
    const [locked] = await tx.select().from(cashSessions).where(eq(cashSessions.id, session.id)).for("update");
    if (locked.status !== "open") throw new ConflictError("El turno ya está cerrado.");
    const summary = await computeSummary(tx, locked);
    const difference = counted! - summary.expectedCash;
    const [closed] = await tx
      .update(cashSessions)
      .set({
        status: "closed",
        closedBy: ctx.userId,
        closedAt: new Date(),
        expectedCash: summary.expectedCash,
        countedCash: counted!,
        difference,
        denominations,
        closingSummary: summary,
        notes: [locked.notes, input.notes].filter(Boolean).join("\n") || null,
      })
      .where(eq(cashSessions.id, session.id))
      .returning();
    await recordAudit(tx, ctx.actor, {
      action: "cash.close",
      entity: "cash_session",
      entityId: session.id,
      branchId: session.branchId,
      reason: input.notes || null,
      after: { expected: summary.expectedCash, counted, difference, sales: summary.salesCount, total: summary.salesTotal },
    });
    return { session: closed, summary };
  });
}

export async function listSessions(ctx: ServiceContext, opts: { branchId?: string; limit?: number } = {}) {
  requirePermission(ctx, "cash.open");
  const company = requireCompany(ctx);
  const branchIds = opts.branchId ? [opts.branchId] : ctx.branches.map((b) => b.id);
  if (!branchIds.length) return [];
  return db
    .select({ session: cashSessions, registerName: cashRegisters.name, openedByName: users.fullName })
    .from(cashSessions)
    .innerJoin(cashRegisters, eq(cashRegisters.id, cashSessions.cashRegisterId))
    .leftJoin(users, eq(users.id, cashSessions.openedBy))
    .where(and(eq(cashSessions.companyId, company.id), inArray(cashSessions.branchId, branchIds)))
    .orderBy(desc(cashSessions.openedAt))
    .limit(Math.min(opts.limit ?? 30, 200));
}
