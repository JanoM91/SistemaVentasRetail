import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { branches, paymentMethods, PAYMENT_KINDS, products, sales, syncEvents, taxProfiles, users } from "@/server/db/schema";
import { recordAudit } from "@/server/audit";
import { requirePermission } from "@/server/authz/guard";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { requireCompany, type ServiceContext } from "@/server/service-context";
import { parseOrThrow } from "@/server/validation";

const bool = z.union([z.boolean(), z.literal("on"), z.literal("true"), z.literal("")]).optional().transform((v) => v === true || v === "on" || v === "true");

// ---------------------------------------------------------------- Métodos de pago

/** Tipos que se pueden dar de alta a mano (crédito y vale son del sistema). */
export const EDITABLE_PAYMENT_KINDS = ["cash", "card_credit", "card_debit", "transfer", "qr", "wallet", "terminal"] as const;
export const PAYMENT_KIND_LABELS: Record<(typeof PAYMENT_KINDS)[number], string> = {
  cash: "Efectivo",
  card_credit: "Tarjeta de crédito",
  card_debit: "Tarjeta de débito",
  transfer: "Transferencia",
  qr: "Pago con QR",
  wallet: "Monedero electrónico",
  terminal: "Terminal integrada",
  customer_credit: "Crédito del cliente",
  gift_card: "Tarjeta de regalo",
  prepaid: "Vale / nota de crédito",
  coupon: "Cupón",
  points: "Puntos",
  financing: "Financiamiento",
};

export const paymentMethodSchema = z.object({
  name: z.string().trim().min(2, "Escribe el nombre").max(40),
  kind: z.enum(EDITABLE_PAYMENT_KINDS).optional(),
  requiresReference: bool,
  isActive: bool,
  sortOrder: z.coerce.number().int().min(0).max(99).default(0),
});

export async function savePaymentMethod(ctx: ServiceContext, id: string | null, raw: unknown) {
  requirePermission(ctx, "settings.manage");
  const company = requireCompany(ctx);
  const v = parseOrThrow(paymentMethodSchema, raw);
  return db.transaction(async (tx) => {
    if (id) {
      const [before] = await tx.select().from(paymentMethods).where(and(eq(paymentMethods.id, id), eq(paymentMethods.companyId, company.id))).limit(1);
      if (!before) throw new NotFoundError("El método de pago");
      if (!v.isActive && before.kind === "cash") {
        const [other] = await tx.select({ id: paymentMethods.id }).from(paymentMethods).where(and(eq(paymentMethods.companyId, company.id), eq(paymentMethods.kind, "cash"), eq(paymentMethods.isActive, true), ne(paymentMethods.id, id))).limit(1);
        if (!other) throw new ConflictError("Debe quedar al menos un método de efectivo activo (las ventas sin conexión lo usan).");
      }
      const [after] = await tx
        .update(paymentMethods)
        .set({ name: v.name, requiresReference: before.kind === "cash" ? false : v.requiresReference, isActive: v.isActive, sortOrder: v.sortOrder, updatedAt: new Date(), updatedBy: ctx.userId })
        .where(eq(paymentMethods.id, id))
        .returning();
      await recordAudit(tx, ctx.actor, { action: "settings.payment_method_update", entity: "payment_method", entityId: id, before: { name: before.name, isActive: before.isActive, requiresReference: before.requiresReference }, after: { name: after.name, isActive: after.isActive, requiresReference: after.requiresReference } });
      return after;
    }
    if (!v.kind) throw new ValidationError({ kind: ["Elige el tipo."] }, "Elige el tipo de método.");
    const base = v.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 16) || "METODO";
    const existing = await tx.select({ code: paymentMethods.code }).from(paymentMethods).where(eq(paymentMethods.companyId, company.id));
    let code = base;
    for (let n = 2; existing.some((e) => e.code === code); n++) code = `${base}_${n}`;
    const [m] = await tx
      .insert(paymentMethods)
      .values({ tenantId: ctx.tenantId, companyId: company.id, code, name: v.name, kind: v.kind, requiresReference: v.kind === "cash" ? false : v.requiresReference, allowsChange: v.kind === "cash", opensDrawer: v.kind === "cash", isActive: v.isActive, sortOrder: v.sortOrder, provider: "manual", createdBy: ctx.userId, updatedBy: ctx.userId })
      .returning();
    await recordAudit(tx, ctx.actor, { action: "settings.payment_method_create", entity: "payment_method", entityId: m.id, after: { code: m.code, name: m.name, kind: m.kind } });
    return m;
  });
}

// ---------------------------------------------------------------- Impuestos

export const taxProfileSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,12}$/, "2 a 12 letras o números").optional(),
  name: z.string().trim().min(2, "Escribe el nombre").max(60),
  kind: z.enum(["iva", "ieps", "otro"]),
  /** Porcentaje: 16 = 16 %. */
  ratePercent: z.coerce.number().min(0, "No puede ser negativo").max(100),
  isIncludedInPrice: bool,
  isDefault: bool,
});

export async function saveTaxProfile(ctx: ServiceContext, id: string | null, raw: unknown) {
  requirePermission(ctx, "settings.manage");
  const company = requireCompany(ctx);
  const v = parseOrThrow(taxProfileSchema, raw);
  const rate = (Math.round(v.ratePercent * 10000) / 1_000_000).toFixed(6);
  try {
    return await db.transaction(async (tx) => {
      if (v.isDefault) await tx.update(taxProfiles).set({ isDefault: false }).where(eq(taxProfiles.companyId, company.id));
      if (id) {
        const [before] = await tx.select().from(taxProfiles).where(and(eq(taxProfiles.id, id), eq(taxProfiles.companyId, company.id))).limit(1);
        if (!before) throw new NotFoundError("El impuesto");
        const [after] = await tx.update(taxProfiles).set({ name: v.name, kind: v.kind, rate, isIncludedInPrice: v.isIncludedInPrice, isDefault: v.isDefault, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(taxProfiles.id, id)).returning();
        const [{ n }] = await tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(products).where(eq(products.taxProfileId, id));
        await recordAudit(tx, ctx.actor, { action: "settings.tax_update", entity: "tax_profile", entityId: id, before: { rate: before.rate, isIncludedInPrice: before.isIncludedInPrice }, after: { rate: after.rate, isIncludedInPrice: after.isIncludedInPrice, productsAffected: n } });
        return { tax: after, productsAffected: n };
      }
      if (!v.code) throw new ValidationError({ code: ["Escribe la clave."] }, "Escribe la clave del impuesto.");
      const [t] = await tx.insert(taxProfiles).values({ tenantId: ctx.tenantId, companyId: company.id, code: v.code, name: v.name, kind: v.kind, rate, isIncludedInPrice: v.isIncludedInPrice, isDefault: v.isDefault, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      await recordAudit(tx, ctx.actor, { action: "settings.tax_create", entity: "tax_profile", entityId: t.id, after: { code: t.code, rate: t.rate } });
      return { tax: t, productsAffected: 0 };
    });
  } catch (e) {
    if (((e as { cause?: { code?: string } }).cause ?? (e as { code?: string }))?.code === "23505") throw new ValidationError({ code: ["Esa clave ya existe."] }, "Esa clave de impuesto ya existe.");
    throw e;
  }
}

// ---------------------------------------------------------------- Revisión de ventas con observaciones

/** Ventas con observaciones sin revisar y envíos rechazados de la sincronización. */
export async function listForReview(ctx: ServiceContext, opts: { includeReviewed?: boolean } = {}) {
  requirePermission(ctx, "pos.cancel");
  const company = requireCompany(ctx);
  const branchIds = ctx.permissions.has("branches.manage") ? null : ctx.branches.map((b) => b.id).concat(["00000000-0000-0000-0000-000000000000"]);
  const flagged = await db
    .select({ s: sales, branchName: branches.name, sellerName: users.fullName })
    .from(sales)
    .innerJoin(branches, eq(branches.id, sales.branchId))
    .innerJoin(users, eq(users.id, sales.soldBy))
    .where(and(eq(sales.companyId, company.id), sql`jsonb_array_length(${sales.flags}) > 0`, opts.includeReviewed ? undefined : isNull(sales.reviewedAt), branchIds ? inArray(sales.branchId, branchIds) : undefined))
    .orderBy(desc(sales.soldAt))
    .limit(200);
  const rejected = await db
    .select({ e: syncEvents, userName: users.fullName, branchName: branches.name })
    .from(syncEvents)
    .leftJoin(users, eq(users.id, syncEvents.userId))
    .leftJoin(branches, eq(branches.id, syncEvents.branchId))
    .where(and(eq(syncEvents.tenantId, ctx.tenantId), eq(syncEvents.status, "rejected"), sql`(${syncEvents.companyId} = ${company.id} or ${syncEvents.companyId} is null)`, opts.includeReviewed ? undefined : isNull(syncEvents.resolvedAt)))
    .orderBy(desc(syncEvents.createdAt))
    .limit(100);
  return { flagged, rejected };
}

const noteSchema = z.object({ note: z.string().trim().min(3, "Escribe qué se hizo").max(500) });

export async function markSaleReviewed(ctx: ServiceContext, saleId: string, raw: unknown) {
  requirePermission(ctx, "pos.cancel");
  const company = requireCompany(ctx);
  const { note } = parseOrThrow(noteSchema, raw);
  const [s] = await db.select().from(sales).where(and(eq(sales.id, saleId), eq(sales.companyId, company.id))).limit(1);
  if (!s) throw new NotFoundError("La venta");
  if (s.reviewedAt) throw new ConflictError("La venta ya fue revisada.");
  await db.transaction(async (tx) => {
    await tx.update(sales).set({ reviewedAt: new Date(), reviewedBy: ctx.userId, reviewNote: note }).where(eq(sales.id, saleId));
    await recordAudit(tx, { ...ctx.actor, branchId: s.branchId }, { action: "pos.review", entity: "sale", entityId: saleId, reason: note, after: { folio: s.folio, flags: s.flags.map((f) => f.code) } });
  });
}

export async function resolveSyncEvent(ctx: ServiceContext, eventId: string, raw: unknown) {
  requirePermission(ctx, "pos.cancel");
  const company = requireCompany(ctx);
  const { note } = parseOrThrow(noteSchema, raw);
  const [e] = await db.select().from(syncEvents).where(and(eq(syncEvents.id, eventId), eq(syncEvents.tenantId, ctx.tenantId))).limit(1);
  if (!e || (e.companyId && e.companyId !== company.id)) throw new NotFoundError("El registro");
  if (e.resolvedAt) throw new ConflictError("Ya está resuelto.");
  await db.transaction(async (tx) => {
    await tx.update(syncEvents).set({ resolvedAt: new Date(), resolvedBy: ctx.userId, detail: { ...e.detail, resolutionNote: note } }).where(eq(syncEvents.id, eventId));
    await recordAudit(tx, ctx.actor, { action: "pos.sync_resolve", entity: "sync_event", entityId: eventId, reason: note });
  });
}
