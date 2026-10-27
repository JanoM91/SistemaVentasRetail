import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx, type Tx } from "@/server/db";
import {
  branches,
  customerCreditMovements,
  customerGroups,
  customers,
  paymentMethods,
  saleLines,
  sales,
  users,
} from "@/server/db/schema";
import { recordAudit } from "@/server/audit";
import { hasPermission, requirePermission } from "@/server/authz/guard";
import { ConflictError, DomainError, NotFoundError, ValidationError } from "@/server/errors";
import { requireCompany, type ServiceContext } from "@/server/service-context";
import { parseOrThrow } from "@/server/validation";
import { parseMoney } from "@/lib/money";
import { nextFolio } from "@/server/modules/sequences";
import { verifyAuthorizer } from "@/server/modules/auth/service";
import { getAccessibleRegister, getOpenSession } from "@/server/modules/cash/service";

// ---------------------------------------------------------------- Utilidades

const opt = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const moneyInput = z.union([z.string(), z.number()]).transform((v, c) => {
  const cents = typeof v === "number" ? Math.round(v) : parseMoney(v);
  if (cents === null || cents < 0) {
    c.addIssue({ code: "custom", message: "Importe inválido" });
    return z.NEVER;
  }
  return cents;
});

/** Fecha local (AAAA-MM-DD) en la zona horaria de la empresa. */
export function localDate(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
const blankToNull = (v: string | undefined | null) => (v && v.trim() ? v.trim() : null);

// ---------------------------------------------------------------- Antigüedad de saldos

export type Aging = { balance: number; current: number; d1_30: number; d31_60: number; d61_90: number; d90: number; overdue: number; oldestDueDate: string | null; credit: number };

/**
 * Antigüedad de saldos por PEPS: los abonos, reversas y ajustes a favor se
 * aplican a los cargos más antiguos. Lo que queda abierto se clasifica por
 * días vencidos. `credit` es saldo a favor sin aplicar.
 */
export function computeAging(movs: Array<{ amount: number; dueDate: string | null; createdAt: Date | string }>, today: string): Aging {
  const sorted = [...movs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const open: Array<{ remaining: number; due: string }> = [];
  let credit = 0;
  for (const m of sorted) {
    if (m.amount > 0) {
      let remaining = m.amount;
      const take = Math.min(credit, remaining);
      credit -= take;
      remaining -= take;
      if (remaining > 0) open.push({ remaining, due: m.dueDate ?? new Date(m.createdAt).toISOString().slice(0, 10) });
    } else if (m.amount < 0) {
      let pay = -m.amount;
      while (pay > 0 && open.length) {
        const take = Math.min(pay, open[0].remaining);
        open[0].remaining -= take;
        pay -= take;
        if (open[0].remaining === 0) open.shift();
      }
      credit += pay;
    }
  }
  const a: Aging = { balance: 0, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0, overdue: 0, oldestDueDate: null, credit };
  for (const o of open) {
    const late = daysBetween(o.due, today);
    if (late <= 0) a.current += o.remaining;
    else if (late <= 30) a.d1_30 += o.remaining;
    else if (late <= 60) a.d31_60 += o.remaining;
    else if (late <= 90) a.d61_90 += o.remaining;
    else a.d90 += o.remaining;
    if (late > 0 && (!a.oldestDueDate || o.due < a.oldestDueDate)) a.oldestDueDate = o.due;
  }
  a.overdue = a.d1_30 + a.d31_60 + a.d61_90 + a.d90;
  a.balance = a.current + a.overdue - credit;
  return a;
}

export async function getAging(conn: DbOrTx, customerId: string, today: string) {
  const movs = await conn
    .select({ amount: customerCreditMovements.amount, dueDate: customerCreditMovements.dueDate, createdAt: customerCreditMovements.createdAt })
    .from(customerCreditMovements)
    .where(eq(customerCreditMovements.customerId, customerId));
  return computeAging(movs, today);
}

// ---------------------------------------------------------------- Grupos

export const groupSchema = z.object({ name: z.string().trim().min(2, "Escribe un nombre").max(60), description: opt(200) });

export async function listGroups(ctx: ServiceContext) {
  requirePermission(ctx, "customers.view");
  const company = requireCompany(ctx);
  return db
    .select({ g: customerGroups, members: sql<number>`(select count(*) from ${customers} c where c.group_id = ${customerGroups.id} and c.deactivated_at is null)`.mapWith(Number) })
    .from(customerGroups)
    .where(and(eq(customerGroups.companyId, company.id), isNull(customerGroups.deactivatedAt)))
    .orderBy(asc(customerGroups.name));
}

export async function saveGroup(ctx: ServiceContext, id: string | null, raw: unknown) {
  requirePermission(ctx, "customers.manage");
  const company = requireCompany(ctx);
  const input = parseOrThrow(groupSchema, raw);
  try {
    return await db.transaction(async (tx) => {
      if (id) {
        const [g] = await tx.update(customerGroups).set({ name: input.name, description: input.description || null, updatedAt: new Date(), updatedBy: ctx.userId }).where(and(eq(customerGroups.id, id), eq(customerGroups.companyId, company.id))).returning();
        if (!g) throw new NotFoundError("El grupo");
        await recordAudit(tx, ctx.actor, { action: "customers.group_update", entity: "customer_group", entityId: g.id, after: { name: g.name } });
        return g;
      }
      const [g] = await tx.insert(customerGroups).values({ tenantId: ctx.tenantId, companyId: company.id, name: input.name, description: input.description || null, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      await recordAudit(tx, ctx.actor, { action: "customers.group_create", entity: "customer_group", entityId: g.id, after: { name: g.name } });
      return g;
    });
  } catch (e) {
    if (((e as { cause?: { code?: string } }).cause ?? (e as { code?: string }))?.code === "23505") throw new ValidationError({ name: ["Ya existe un grupo con ese nombre."] }, "Ya existe un grupo con ese nombre.");
    throw e;
  }
}

// ---------------------------------------------------------------- Clientes

const RFC = /^([A-ZÑ&]{3,4})\d{6}([A-Z\d]{3})$/;

export const customerSchema = z
  .object({
    name: z.string().trim().min(2, "Escribe el nombre").max(120),
    phone: z.string().trim().max(20).regex(/^[\d\s+()-]*$/, "Solo números").optional().or(z.literal("")),
    email: z.string().trim().max(120).email("Correo inválido").optional().or(z.literal("")),
    birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
    groupId: z.string().uuid().optional().or(z.literal("")),
    taxId: z
      .string()
      .trim()
      .toUpperCase()
      .refine((v) => !v || RFC.test(v), "RFC inválido (12 o 13 caracteres)")
      .optional(),
    legalName: opt(200),
    taxRegime: opt(5),
    cfdiUse: opt(5),
    taxPostalCode: z.string().trim().regex(/^(\d{5})?$/, "C.P. de 5 dígitos").optional(),
    address: z.record(z.string(), z.string().trim().max(120)).optional(),
    notes: opt(1000),
    marketingConsent: z.union([z.boolean(), z.literal("on"), z.literal("true"), z.literal("1"), z.literal("")]).optional(),
  })
  .refine((v) => (v.phone ?? "").replace(/\D/g, "").length === 0 || (v.phone ?? "").replace(/\D/g, "").length >= 10, { path: ["phone"], message: "El teléfono debe tener 10 dígitos" });

const consent = (v: unknown) => v === true || v === "on" || v === "true" || v === "1";

async function assertGroup(companyId: string, groupId: string | undefined) {
  if (!groupId) return null;
  const [g] = await db.select({ id: customerGroups.id }).from(customerGroups).where(and(eq(customerGroups.id, groupId), eq(customerGroups.companyId, companyId))).limit(1);
  if (!g) throw new NotFoundError("El grupo");
  return g.id;
}

/** Clientes con el mismo teléfono o correo (aviso de posible duplicado). */
export async function findDuplicates(ctx: ServiceContext, phone: string | null, email: string | null, exceptId?: string) {
  const company = requireCompany(ctx);
  const conds: SQL[] = [];
  const digits = phone?.replace(/\D/g, "");
  if (digits) conds.push(sql`regexp_replace(coalesce(${customers.phone}, ''), '\\D', '', 'g') = ${digits}`);
  if (email) conds.push(sql`lower(${customers.email}) = ${email.toLowerCase()}`);
  if (!conds.length) return [];
  const where: SQL[] = [eq(customers.companyId, company.id), isNull(customers.deactivatedAt), or(...conds)!];
  if (exceptId) where.push(ne(customers.id, exceptId));
  return db.select({ id: customers.id, code: customers.code, name: customers.name }).from(customers).where(and(...where)).limit(5);
}

export async function createCustomer(ctx: ServiceContext, raw: unknown, opts: { allowDuplicate?: boolean } = {}) {
  requirePermission(ctx, "customers.manage");
  const company = requireCompany(ctx);
  const input = parseOrThrow(customerSchema, raw);
  const groupId = await assertGroup(company.id, input.groupId || undefined);
  if (!opts.allowDuplicate) {
    const dup = await findDuplicates(ctx, blankToNull(input.phone), blankToNull(input.email));
    if (dup.length) throw new DomainError("duplicate_customer", `Ya existe ${dup[0].name} (${dup[0].code}) con ese teléfono o correo.`, 409);
  }
  return db.transaction(async (tx) => {
    const folio = await nextFolio(tx, { tenantId: ctx.tenantId, companyId: company.id, branchId: null, documentType: "customer" });
    const [c] = await tx
      .insert(customers)
      .values({
        tenantId: ctx.tenantId,
        companyId: company.id,
        code: folio.folio,
        name: input.name,
        phone: blankToNull(input.phone),
        email: blankToNull(input.email)?.toLowerCase() ?? null,
        birthday: blankToNull(input.birthday),
        groupId,
        taxId: blankToNull(input.taxId),
        legalName: blankToNull(input.legalName),
        taxRegime: blankToNull(input.taxRegime),
        cfdiUse: blankToNull(input.cfdiUse),
        taxPostalCode: blankToNull(input.taxPostalCode),
        address: input.address ?? {},
        notes: blankToNull(input.notes),
        marketingConsent: consent(input.marketingConsent),
        marketingConsentAt: consent(input.marketingConsent) ? new Date() : null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    await recordAudit(tx, ctx.actor, { action: "customers.create", entity: "customer", entityId: c.id, after: { code: c.code, name: c.name } });
    return c;
  });
}

export async function updateCustomer(ctx: ServiceContext, id: string, raw: unknown) {
  requirePermission(ctx, "customers.manage");
  const company = requireCompany(ctx);
  const before = await getCustomer(ctx, id);
  const input = parseOrThrow(customerSchema, raw);
  const groupId = await assertGroup(company.id, input.groupId || undefined);
  const give = consent(input.marketingConsent);
  return db.transaction(async (tx) => {
    const [c] = await tx
      .update(customers)
      .set({
        name: input.name,
        phone: blankToNull(input.phone),
        email: blankToNull(input.email)?.toLowerCase() ?? null,
        birthday: blankToNull(input.birthday),
        groupId,
        taxId: blankToNull(input.taxId),
        legalName: blankToNull(input.legalName),
        taxRegime: blankToNull(input.taxRegime),
        cfdiUse: blankToNull(input.cfdiUse),
        taxPostalCode: blankToNull(input.taxPostalCode),
        address: input.address ?? before.address,
        notes: blankToNull(input.notes),
        marketingConsent: give,
        marketingConsentAt: give ? (before.marketingConsent ? before.marketingConsentAt : new Date()) : null,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(eq(customers.id, id))
      .returning();
    await recordAudit(tx, ctx.actor, {
      action: "customers.update",
      entity: "customer",
      entityId: id,
      before: { name: before.name, phone: before.phone, email: before.email, taxId: before.taxId, marketingConsent: before.marketingConsent },
      after: { name: c.name, phone: c.phone, email: c.email, taxId: c.taxId, marketingConsent: c.marketingConsent },
    });
    return c;
  });
}

export async function setCustomerActive(ctx: ServiceContext, id: string, active: boolean, reason?: string) {
  requirePermission(ctx, "customers.manage");
  const c = await getCustomer(ctx, id);
  if (!active && c.creditBalance > 0) throw new ConflictError(`${c.name} tiene saldo pendiente; cóbralo antes de desactivarlo.`);
  await db.transaction(async (tx) => {
    await tx.update(customers).set({ deactivatedAt: active ? null : new Date(), deactivatedBy: active ? null : ctx.userId, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(customers.id, id));
    await recordAudit(tx, ctx.actor, { action: active ? "customers.reactivate" : "customers.deactivate", entity: "customer", entityId: id, reason: reason || null });
  });
}

export async function getCustomer(ctx: ServiceContext, id: string, conn: DbOrTx = db) {
  requirePermission(ctx, "customers.view");
  const company = requireCompany(ctx);
  const [c] = await conn.select().from(customers).where(and(eq(customers.id, id), eq(customers.companyId, company.id))).limit(1);
  if (!c) throw new NotFoundError("El cliente");
  return c;
}

// ---------------------------------------------------------------- Segmentos

export const SEGMENTS = {
  nuevos: { label: "Nuevos", hint: "primera compra en los últimos 30 días" },
  frecuentes: { label: "Frecuentes", hint: "4 o más compras en 90 días" },
  en_riesgo: { label: "En riesgo", hint: "compraban y no han vuelto en 60 días" },
  sin_compras: { label: "Sin compras", hint: "registrados que aún no compran" },
  con_saldo: { label: "Con saldo", hint: "deben a crédito" },
  vencidos: { label: "Con vencidos", hint: "tienen cargos vencidos" },
  marketing: { label: "Aceptan promociones", hint: "dieron consentimiento" },
} as const;
export type Segment = keyof typeof SEGMENTS;

const recent90 = sql<number>`(select count(*) from ${sales} s where s.customer_id = ${customers.id} and s.status = 'completed' and s.sold_at >= now() - interval '90 days')`.mapWith(Number);

/** Clientes con saldo vencido según la antigüedad PEPS (los abonos ya aplicados no cuentan). */
async function overdueCustomerIds(companyId: string, tz: string) {
  const debtors = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.companyId, companyId), gt(customers.creditBalance, 0)));
  if (!debtors.length) return [];
  const movs = await db
    .select({ customerId: customerCreditMovements.customerId, amount: customerCreditMovements.amount, dueDate: customerCreditMovements.dueDate, createdAt: customerCreditMovements.createdAt })
    .from(customerCreditMovements)
    .where(inArray(customerCreditMovements.customerId, debtors.map((d) => d.id)));
  const today = localDate(new Date(), tz);
  return debtors.map((d) => d.id).filter((id) => computeAging(movs.filter((m) => m.customerId === id), today).overdue > 0);
}

export async function listCustomers(ctx: ServiceContext, opts: { q?: string | null; segment?: string | null; groupId?: string | null; includeInactive?: boolean; limit?: number } = {}) {
  requirePermission(ctx, "customers.view");
  const company = requireCompany(ctx);
  const where: SQL[] = [eq(customers.companyId, company.id)];
  if (!opts.includeInactive) where.push(isNull(customers.deactivatedAt));
  const q = opts.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    const conds: SQL[] = [ilike(customers.name, `%${q}%`), ilike(customers.code, `%${q}%`), ilike(customers.email, `%${q}%`), ilike(customers.taxId, `%${q}%`)];
    if (digits.length >= 4) conds.push(sql`regexp_replace(coalesce(${customers.phone}, ''), '\\D', '', 'g') like ${`%${digits}%`}`);
    where.push(or(...conds)!);
  }
  if (opts.groupId) where.push(eq(customers.groupId, opts.groupId));
  switch (opts.segment) {
    case "nuevos": where.push(sql`${customers.firstPurchaseAt} >= now() - interval '30 days'`); break;
    case "frecuentes": where.push(sql`${recent90} >= 4`); break;
    case "en_riesgo": where.push(sql`${customers.lastPurchaseAt} < now() - interval '60 days' and ${customers.purchasesCount} >= 2`); break;
    case "sin_compras": where.push(eq(customers.purchasesCount, 0)); break;
    case "con_saldo": where.push(gt(customers.creditBalance, 0)); break;
    case "vencidos": {
      const ids = await overdueCustomerIds(company.id, company.timezone);
      where.push(ids.length ? inArray(customers.id, ids) : sql`false`);
      break;
    }
    case "marketing": where.push(eq(customers.marketingConsent, true)); break;
  }
  return db
    .select({ c: customers, groupName: customerGroups.name, recent90 })
    .from(customers)
    .leftJoin(customerGroups, eq(customerGroups.id, customers.groupId))
    .where(and(...where))
    .orderBy(desc(sql`coalesce(${customers.lastPurchaseAt}, ${customers.createdAt})`))
    .limit(Math.min(opts.limit ?? 200, 1000));
}

/** Búsqueda rápida para el POS: incluye el crédito disponible y lo vencido. */
export async function searchCustomersForPos(ctx: ServiceContext, q: string) {
  requirePermission(ctx, "customers.view");
  const company = requireCompany(ctx);
  const rows = (await listCustomers(ctx, { q, limit: 10 })).map((r) => r.c);
  if (!q.trim()) return [];
  return Promise.all(rows.map((c) => posCustomerView(c, company.timezone)));
}

export async function getPosCustomer(ctx: ServiceContext, id: string) {
  const company = requireCompany(ctx);
  return posCustomerView(await getCustomer(ctx, id), company.timezone);
}

async function posCustomerView(c: typeof customers.$inferSelect, tz: string) {
  const aging = c.creditLimit !== null || c.creditBalance !== 0 ? await getAging(db, c.id, localDate(new Date(), tz)) : null;
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    phone: c.phone,
    email: c.email,
    taxId: c.taxId,
    credit:
      c.creditLimit === null
        ? null
        : { limit: c.creditLimit, balance: c.creditBalance, available: Math.max(0, c.creditLimit - c.creditBalance), overdue: aging?.overdue ?? 0, blocked: c.creditBlocked, days: c.creditDays },
    balance: c.creditBalance,
  };
}
export type PosCustomer = Awaited<ReturnType<typeof posCustomerView>>;

/** Ficha completa: datos, estadísticas, historial, productos favoritos y estado de cuenta. */
export async function getCustomerProfile(ctx: ServiceContext, id: string) {
  const company = requireCompany(ctx);
  const c = await getCustomer(ctx, id);
  const showCredit = hasPermission(ctx, "credit.view");
  const [group, recentSales, topProducts, movements] = await Promise.all([
    c.groupId ? db.select().from(customerGroups).where(eq(customerGroups.id, c.groupId)).then((r) => r[0] ?? null) : Promise.resolve(null),
    db
      .select({ s: sales, branchName: branches.name, sellerName: users.fullName })
      .from(sales)
      .innerJoin(branches, eq(branches.id, sales.branchId))
      .innerJoin(users, eq(users.id, sales.soldBy))
      .where(and(eq(sales.customerId, id), eq(sales.companyId, company.id)))
      .orderBy(desc(sales.soldAt))
      .limit(50),
    db
      .select({ sku: saleLines.sku, description: saleLines.description, qty: sql<number>`sum(${saleLines.quantity})`.mapWith(Number), total: sql<number>`sum(${saleLines.lineTotal})`.mapWith(Number), times: sql<number>`count(distinct ${saleLines.saleId})`.mapWith(Number) })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId))
      .where(and(eq(sales.customerId, id), eq(sales.status, "completed")))
      .groupBy(saleLines.sku, saleLines.description)
      .orderBy(desc(sql`count(distinct ${saleLines.saleId})`), desc(sql`sum(${saleLines.lineTotal})`))
      .limit(10),
    showCredit
      ? db
          .select({ m: customerCreditMovements, saleFolio: sales.folio, methodName: paymentMethods.name, userName: users.fullName })
          .from(customerCreditMovements)
          .leftJoin(sales, eq(sales.id, customerCreditMovements.saleId))
          .leftJoin(paymentMethods, eq(paymentMethods.id, customerCreditMovements.paymentMethodId))
          .innerJoin(users, eq(users.id, customerCreditMovements.createdBy))
          .where(eq(customerCreditMovements.customerId, id))
          .orderBy(desc(customerCreditMovements.createdAt))
          .limit(200)
      : Promise.resolve([]),
  ]);
  const aging = showCredit ? computeAging(movements.map((r) => r.m), localDate(new Date(), company.timezone)) : null;
  const avgTicket = c.purchasesCount ? Math.round(c.purchasesTotal / c.purchasesCount) : 0;
  return { customer: c, group, recentSales, topProducts, movements, aging, avgTicket, showCredit };
}

// ---------------------------------------------------------------- Condiciones de crédito

export const creditTermsSchema = z.object({
  enabled: z.union([z.boolean(), z.literal("on"), z.literal("")]).optional(),
  creditLimit: moneyInput.optional(),
  creditDays: z.coerce.number().int().min(0).max(365).default(30),
  creditBlocked: z.union([z.boolean(), z.literal("on"), z.literal("")]).optional(),
});

export async function setCreditTerms(ctx: ServiceContext, id: string, raw: unknown) {
  requirePermission(ctx, "customers.credit_manage");
  const before = await getCustomer(ctx, id);
  const input = parseOrThrow(creditTermsSchema, raw);
  const enabled = consent(input.enabled);
  if (enabled && (input.creditLimit === undefined || input.creditLimit <= 0)) throw new ValidationError({ creditLimit: ["Indica el límite."] }, "Indica el límite de crédito.");
  const limit = enabled ? input.creditLimit! : null;
  return db.transaction(async (tx) => {
    const [c] = await tx
      .update(customers)
      .set({ creditLimit: limit, creditDays: input.creditDays, creditBlocked: consent(input.creditBlocked), updatedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(customers.id, id))
      .returning();
    await recordAudit(tx, ctx.actor, {
      action: "customers.credit_terms",
      entity: "customer",
      entityId: id,
      before: { creditLimit: before.creditLimit, creditDays: before.creditDays, creditBlocked: before.creditBlocked },
      after: { creditLimit: c.creditLimit, creditDays: c.creditDays, creditBlocked: c.creditBlocked },
    });
    return c;
  });
}

// ---------------------------------------------------------------- Venta a crédito (usado por ventas)

/**
 * Valida una venta a crédito antes de registrarla. Fuera del límite o con
 * cargos vencidos requiere autorización de alguien con
 * `customers.credit_manage`; sin `pos.credit_sale` requiere autorización.
 */
export async function checkCreditSale(ctx: ServiceContext, customer: typeof customers.$inferSelect, amount: number, authorization?: { username: string; password: string }) {
  const company = requireCompany(ctx);
  if (!ctx.enabledModules.has("credit")) throw new ConflictError("La venta a crédito no está activa en esta empresa (módulo Crédito).");
  if (customer.creditLimit === null) throw new ConflictError(`${customer.name} no tiene crédito autorizado.`);
  if (customer.creditBlocked) throw new ConflictError(`El crédito de ${customer.name} está bloqueado.`);
  if (customer.deactivatedAt) throw new ConflictError(`${customer.name} está desactivado.`);
  let authorizedBy: string | null = null;
  const verify = async (permission: "pos.credit_sale" | "customers.credit_manage") => {
    if (!authorization) return null;
    return (await verifyAuthorizer({ tenantId: ctx.tenantId, companyId: company.id, ...authorization, permission })).authorizerId;
  };
  if (!hasPermission(ctx, "pos.credit_sale")) {
    authorizedBy = await verify("pos.credit_sale");
    if (!authorizedBy) throw new DomainError("credit_authorization_required", "Vender a crédito requiere autorización de un gerente.", 403);
  }
  const available = customer.creditLimit - customer.creditBalance;
  const aging = await getAging(db, customer.id, localDate(new Date(), company.timezone));
  const reasons: string[] = [];
  if (amount > available) reasons.push(`excede el crédito disponible (${(Math.max(0, available) / 100).toFixed(2)})`);
  if (aging.overdue > 0) reasons.push(`tiene ${(aging.overdue / 100).toFixed(2)} vencido`);
  if (reasons.length) {
    const by = await verify("customers.credit_manage");
    if (!by) throw new DomainError("credit_authorization_required", `${customer.name} ${reasons.join(" y ")}. Requiere autorización de un gerente.`, 403);
    authorizedBy = by;
  }
  return { authorizedBy, overLimit: amount > available, overdue: aging.overdue };
}

/** Registra el cargo de una venta a crédito (dentro de la transacción de la venta). */
export async function postCreditCharge(
  tx: Tx,
  ctx: ServiceContext,
  input: { customerId: string; saleId: string; folio: string; branchId: string; amount: number; soldAt: Date; authorizedBy: string | null; enforceLimit?: boolean },
) {
  const company = requireCompany(ctx);
  const [c] = await tx.select().from(customers).where(eq(customers.id, input.customerId)).for("update");
  const balance = c.creditBalance + input.amount;
  // Dos ventas simultáneas al mismo cliente: con la fila bloqueada se revisa de nuevo el límite.
  if (input.enforceLimit && c.creditLimit !== null && balance > c.creditLimit) throw new ConflictError(`${c.name} ya no tiene crédito disponible suficiente. Vuelve a cobrar.`);
  const dueDate = addDays(localDate(input.soldAt, company.timezone), c.creditDays);
  await tx.insert(customerCreditMovements).values({
    tenantId: ctx.tenantId,
    companyId: company.id,
    customerId: c.id,
    branchId: input.branchId,
    kind: "charge",
    amount: input.amount,
    balanceAfter: balance,
    folio: input.folio,
    saleId: input.saleId,
    dueDate,
    createdBy: ctx.userId,
    authorizedBy: input.authorizedBy,
  });
  await tx.update(customers).set({ creditBalance: balance }).where(eq(customers.id, c.id));
  return { balance, dueDate };
}

/** Reversa el cargo de una venta cancelada. */
export async function reverseCreditCharge(tx: Tx, ctx: ServiceContext, sale: { id: string; folio: string; branchId: string; customerId: string | null }) {
  if (!sale.customerId) return null;
  const [charge] = await tx.select().from(customerCreditMovements).where(and(eq(customerCreditMovements.saleId, sale.id), eq(customerCreditMovements.kind, "charge"))).limit(1);
  if (!charge) return null;
  const [c] = await tx.select().from(customers).where(eq(customers.id, sale.customerId)).for("update");
  const balance = c.creditBalance - charge.amount;
  await tx.insert(customerCreditMovements).values({
    tenantId: ctx.tenantId,
    companyId: c.companyId,
    customerId: c.id,
    branchId: sale.branchId,
    kind: "reversal",
    amount: -charge.amount,
    balanceAfter: balance,
    folio: sale.folio,
    saleId: sale.id,
    notes: "Cancelación de la venta",
    createdBy: ctx.userId,
  });
  await tx.update(customers).set({ creditBalance: balance }).where(eq(customers.id, c.id));
  return { balance };
}

/** Estadísticas de compra del cliente (+1 al vender, −1 al cancelar). */
export async function bumpPurchaseStats(tx: Tx, customerId: string, sign: 1 | -1, total: number, soldAt: Date) {
  if (sign === 1) {
    await tx
      .update(customers)
      .set({
        purchasesCount: sql`${customers.purchasesCount} + 1`,
        purchasesTotal: sql`${customers.purchasesTotal} + ${total}`,
        firstPurchaseAt: sql`least(coalesce(${customers.firstPurchaseAt}, ${soldAt}), ${soldAt})`,
        lastPurchaseAt: sql`greatest(coalesce(${customers.lastPurchaseAt}, ${soldAt}), ${soldAt})`,
      })
      .where(eq(customers.id, customerId));
  } else {
    await tx
      .update(customers)
      .set({ purchasesCount: sql`greatest(${customers.purchasesCount} - 1, 0)`, purchasesTotal: sql`greatest(${customers.purchasesTotal} - ${total}, 0)` })
      .where(eq(customers.id, customerId));
  }
}

// ---------------------------------------------------------------- Abonos

export const customerPaymentSchema = z.object({
  /** Id generado por el cliente: reenviar el mismo abono no lo duplica. */
  id: z.string().uuid().optional(),
  customerId: z.string().uuid("Elige un cliente"),
  amount: moneyInput,
  paymentMethodId: z.string().uuid("Elige el método de pago"),
  reference: opt(80),
  notes: opt(300),
  cashRegisterId: z.string().uuid().optional().or(z.literal("")),
});

/**
 * Abono a la cuenta del cliente. En caja (con `cashRegisterId`) basta con
 * poder vender y ver cuentas por cobrar, y el efectivo entra al corte del
 * turno. Fuera de caja requiere `credit.manage` y no admite efectivo.
 */
export async function registerCustomerPayment(ctx: ServiceContext, raw: unknown) {
  const company = requireCompany(ctx);
  const input = parseOrThrow(customerPaymentSchema, raw);
  const atRegister = !!input.cashRegisterId;
  if (atRegister) {
    requirePermission(ctx, "pos.sell");
    requirePermission(ctx, "credit.view");
  } else requirePermission(ctx, "credit.manage");
  if (input.amount <= 0) throw new ValidationError({ amount: ["Debe ser mayor a cero."] }, "El abono debe ser mayor a cero.");
  if (input.id) {
    const [dup] = await db.select().from(customerCreditMovements).where(and(eq(customerCreditMovements.id, input.id), eq(customerCreditMovements.companyId, company.id))).limit(1);
    if (dup) return { movement: dup, duplicate: true };
  }
  const customer = await getCustomer(ctx, input.customerId);
  const [method] = await db.select().from(paymentMethods).where(and(eq(paymentMethods.id, input.paymentMethodId), eq(paymentMethods.companyId, company.id), eq(paymentMethods.isActive, true))).limit(1);
  if (!method || method.kind === "customer_credit") throw new ValidationError({ paymentMethodId: ["Método no válido para abonos."] }, "Método de pago no válido para abonos.");
  if (method.requiresReference && !input.reference) throw new ValidationError({ reference: [`${method.name} requiere referencia.`] }, `${method.name} requiere referencia.`);
  let session: { id: string } | null = null;
  let branchId: string | null = ctx.branch?.id ?? null;
  if (atRegister) {
    const reg = await getAccessibleRegister(ctx, input.cashRegisterId!);
    session = await getOpenSession(db, reg.id);
    if (!session) throw new ConflictError(`${reg.name} no tiene un turno abierto.`);
    branchId = reg.branchId;
  } else if (method.kind === "cash") throw new ValidationError({ paymentMethodId: ["El efectivo se recibe en caja."] }, "Los abonos en efectivo se registran desde el punto de venta para que entren al corte.");

  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(customers).where(eq(customers.id, customer.id)).for("update");
    if (input.amount > c.creditBalance) throw new ValidationError({ amount: [`El saldo es ${(c.creditBalance / 100).toFixed(2)}.`] }, `El abono excede el saldo (${(c.creditBalance / 100).toFixed(2)}).`);
    const folio = await nextFolio(tx, { tenantId: ctx.tenantId, companyId: company.id, branchId: null, documentType: "customer_payment" });
    const balance = c.creditBalance - input.amount;
    const [m] = await tx
      .insert(customerCreditMovements)
      .values({
        ...(input.id ? { id: input.id } : {}),
        tenantId: ctx.tenantId,
        companyId: company.id,
        customerId: c.id,
        branchId,
        kind: "payment",
        amount: -input.amount,
        balanceAfter: balance,
        folio: folio.folio,
        paymentMethodId: method.id,
        paymentKind: method.kind,
        cashSessionId: session?.id ?? null,
        reference: input.reference || null,
        notes: input.notes || null,
        createdBy: ctx.userId,
      })
      .returning();
    await tx.update(customers).set({ creditBalance: balance }).where(eq(customers.id, c.id));
    await recordAudit(tx, { ...ctx.actor, branchId }, { action: "credit.payment", entity: "customer", entityId: c.id, before: { balance: c.creditBalance }, after: { folio: m.folio, amount: input.amount, method: method.name, balance } });
    return { movement: m, duplicate: false };
  });
}

export const creditAdjustmentSchema = z.object({
  customerId: z.string().uuid(),
  direction: z.enum(["charge", "credit"]),
  amount: moneyInput,
  reason: z.string().trim().min(5, "Explica el motivo").max(300),
});

/** Ajuste manual al saldo (corrección, condonación, saldo inicial). Queda en bitácora con motivo. */
export async function adjustCredit(ctx: ServiceContext, raw: unknown) {
  requirePermission(ctx, "credit.manage");
  requirePermission(ctx, "customers.credit_manage");
  const company = requireCompany(ctx);
  const input = parseOrThrow(creditAdjustmentSchema, raw);
  if (input.amount <= 0) throw new ValidationError({ amount: ["Debe ser mayor a cero."] }, "El importe debe ser mayor a cero.");
  const customer = await getCustomer(ctx, input.customerId);
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(customers).where(eq(customers.id, customer.id)).for("update");
    const amount = input.direction === "charge" ? input.amount : -input.amount;
    if (c.creditBalance + amount < 0) throw new ValidationError({ amount: ["Deja el saldo en negativo."] }, `El ajuste a favor no puede exceder el saldo (${(c.creditBalance / 100).toFixed(2)}).`);
    const balance = c.creditBalance + amount;
    const [m] = await tx
      .insert(customerCreditMovements)
      .values({
        tenantId: ctx.tenantId,
        companyId: company.id,
        customerId: c.id,
        branchId: ctx.branch?.id ?? null,
        kind: "adjustment",
        amount,
        balanceAfter: balance,
        dueDate: input.direction === "charge" ? addDays(localDate(new Date(), company.timezone), c.creditDays) : null,
        notes: input.reason,
        createdBy: ctx.userId,
      })
      .returning();
    await tx.update(customers).set({ creditBalance: balance }).where(eq(customers.id, c.id));
    await recordAudit(tx, ctx.actor, { action: "credit.adjustment", entity: "customer", entityId: c.id, reason: input.reason, before: { balance: c.creditBalance }, after: { amount, balance } });
    return m;
  });
}

export async function getCustomerPayment(ctx: ServiceContext, movementId: string) {
  requirePermission(ctx, "credit.view");
  const company = requireCompany(ctx);
  const [row] = await db
    .select({ m: customerCreditMovements, customer: customers, methodName: paymentMethods.name, userName: users.fullName, branchName: branches.name })
    .from(customerCreditMovements)
    .innerJoin(customers, eq(customers.id, customerCreditMovements.customerId))
    .innerJoin(users, eq(users.id, customerCreditMovements.createdBy))
    .leftJoin(paymentMethods, eq(paymentMethods.id, customerCreditMovements.paymentMethodId))
    .leftJoin(branches, eq(branches.id, customerCreditMovements.branchId))
    .where(and(eq(customerCreditMovements.id, movementId), eq(customerCreditMovements.companyId, company.id), eq(customerCreditMovements.kind, "payment")))
    .limit(1);
  if (!row) throw new NotFoundError("El abono");
  return row;
}

// ---------------------------------------------------------------- Cuentas por cobrar

export async function listReceivables(ctx: ServiceContext) {
  requirePermission(ctx, "credit.view");
  const company = requireCompany(ctx);
  const rows = await db.select().from(customers).where(and(eq(customers.companyId, company.id), or(ne(customers.creditBalance, 0), isNotNull(customers.creditLimit))!)).orderBy(desc(customers.creditBalance));
  const withBalance = rows.filter((c) => c.creditBalance !== 0);
  const ids = withBalance.map((c) => c.id);
  const movs = ids.length
    ? await db.select({ customerId: customerCreditMovements.customerId, amount: customerCreditMovements.amount, dueDate: customerCreditMovements.dueDate, createdAt: customerCreditMovements.createdAt }).from(customerCreditMovements).where(inArray(customerCreditMovements.customerId, ids))
    : [];
  const today = localDate(new Date(), company.timezone);
  const by = new Map<string, typeof movs>();
  for (const m of movs) (by.get(m.customerId) ?? by.set(m.customerId, []).get(m.customerId)!).push(m);
  const lastPay = ids.length
    ? await db
        .select({ customerId: customerCreditMovements.customerId, at: sql<Date>`max(${customerCreditMovements.createdAt})` })
        .from(customerCreditMovements)
        .where(and(inArray(customerCreditMovements.customerId, ids), eq(customerCreditMovements.kind, "payment")))
        .groupBy(customerCreditMovements.customerId)
    : [];
  const list = withBalance.map((c) => ({ customer: c, aging: computeAging(by.get(c.id) ?? [], today), lastPaymentAt: lastPay.find((x) => x.customerId === c.id)?.at ?? null }));
  const totals = list.reduce(
    (t, r) => ({ balance: t.balance + r.aging.balance, current: t.current + r.aging.current, d1_30: t.d1_30 + r.aging.d1_30, d31_60: t.d31_60 + r.aging.d31_60, d61_90: t.d61_90 + r.aging.d61_90, d90: t.d90 + r.aging.d90, overdue: t.overdue + r.aging.overdue }),
    { balance: 0, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0, overdue: 0 },
  );
  const limits = rows.filter((c) => c.creditLimit !== null);
  return { list: list.sort((a, b) => b.aging.overdue - a.aging.overdue || b.aging.balance - a.aging.balance), totals, withCredit: limits.length, totalLimit: limits.reduce((a, c) => a + (c.creditLimit ?? 0), 0) };
}

// ---------------------------------------------------------------- Exportación

export async function exportCustomersCsv(ctx: ServiceContext) {
  requirePermission(ctx, "customers.export");
  const rows = await listCustomers(ctx, { limit: 1000, includeInactive: true });
  const showCredit = hasPermission(ctx, "credit.view");
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["Clave", "Nombre", "Teléfono", "Correo", "RFC", "Grupo", "Compras", "Total comprado", "Última compra", "Acepta promociones", ...(showCredit ? ["Límite de crédito", "Saldo"] : []), "Activo"];
  const lines = rows.map(({ c, groupName }) =>
    [c.code, c.name, c.phone, c.email, c.taxId, groupName, c.purchasesCount, (c.purchasesTotal / 100).toFixed(2), c.lastPurchaseAt?.toISOString().slice(0, 10), c.marketingConsent ? "Sí" : "No", ...(showCredit ? [c.creditLimit === null ? "" : (c.creditLimit / 100).toFixed(2), (c.creditBalance / 100).toFixed(2)] : []), c.deactivatedAt ? "No" : "Sí"]
      .map(esc)
      .join(","),
  );
  await recordAudit(db, ctx.actor, { action: "customers.export", entity: "customer", after: { rows: rows.length } });
  return "﻿" + [head.join(","), ...lines].join("\n");
}



/** Métodos para abonos registrados fuera de caja (sin efectivo ni crédito). */
export async function listBackofficePaymentMethods(ctx: ServiceContext) {
  const company = requireCompany(ctx);
  const rows = await db.select({ id: paymentMethods.id, name: paymentMethods.name, kind: paymentMethods.kind, requiresReference: paymentMethods.requiresReference }).from(paymentMethods).where(and(eq(paymentMethods.companyId, company.id), eq(paymentMethods.isActive, true))).orderBy(asc(paymentMethods.sortOrder));
  return rows.filter((m) => m.kind !== "cash" && m.kind !== "customer_credit");
}
