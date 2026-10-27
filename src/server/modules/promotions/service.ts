import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { db, type DbOrTx, type Tx } from "@/server/db";
import { coupons, customerGroups, priceListItems, priceLists, products, productVariants, promotionRedemptions, promotions } from "@/server/db/schema";
import { recordAudit } from "@/server/audit";
import { requirePermission } from "@/server/authz/guard";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { requireCompany, type ServiceContext } from "@/server/service-context";
import { parseOrThrow } from "@/server/validation";
import { parseMoney } from "@/lib/money";
import { PROMOTION_KINDS, type PriceListRule, type PromotionRule } from "@/lib/promotions";

// ---------------------------------------------------------------- Conversión a reglas del motor

type PromoRow = typeof promotions.$inferSelect;

/** Fila de BD → regla del motor. Los productos se expanden a sus variantes en el motor por `productId`. */
export function toRule(p: PromoRow): PromotionRule {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    percent: p.percent === null ? null : Number(p.percent),
    amount: p.amount,
    buyQty: p.buyQty,
    payQty: p.payQty,
    tiers: p.tiers,
    bundle: p.bundle,
    bundlePrice: p.bundlePrice,
    scope: p.scope,
    categoryIds: p.categoryIds,
    productIds: p.productIds,
    startsAt: p.startsAt?.toISOString() ?? null,
    endsAt: p.endsAt?.toISOString() ?? null,
    daysOfWeek: p.daysOfWeek,
    timeFrom: p.timeFrom,
    timeTo: p.timeTo,
    branchIds: p.branchIds,
    customerGroupIds: p.customerGroupIds,
    requiresCoupon: p.requiresCoupon,
    minPurchase: p.minPurchase,
    priority: p.priority,
    stackable: p.stackable,
    active: p.isActive && !p.deactivatedAt,
  };
}

/** Promociones vigentes (activas y no vencidas) de la empresa, como reglas del motor. */
export async function activeRules(conn: DbOrTx, companyId: string) {
  const rows = await conn
    .select()
    .from(promotions)
    .where(and(eq(promotions.companyId, companyId), eq(promotions.isActive, true), isNull(promotions.deactivatedAt), sql`(${promotions.endsAt} is null or ${promotions.endsAt} > now() - interval '1 day')`));
  return { rows, rules: rows.map(toRule) };
}

/** Promociones que ya agotaron sus usos (totales o, si se indica cliente, por cliente). */
export async function exhaustedPromotionIds(conn: DbOrTx, rows: PromoRow[], customerId?: string | null) {
  const limited = rows.filter((p) => p.maxUses || (customerId && p.maxUsesPerCustomer));
  if (!limited.length) return [];
  const counts = await conn
    .select({
      promotionId: promotionRedemptions.promotionId,
      total: sql<number>`count(*)`.mapWith(Number),
      mine: customerId ? sql<number>`count(*) filter (where ${promotionRedemptions.customerId} = ${customerId})`.mapWith(Number) : sql<number>`0`.mapWith(Number),
    })
    .from(promotionRedemptions)
    .where(and(inArray(promotionRedemptions.promotionId, limited.map((p) => p.id)), eq(promotionRedemptions.status, "applied")))
    .groupBy(promotionRedemptions.promotionId);
  return limited
    .filter((p) => {
      const c = counts.find((x) => x.promotionId === p.id);
      if (!c) return false;
      return (p.maxUses && c.total >= p.maxUses) || (customerId && p.maxUsesPerCustomer && c.mine >= p.maxUsesPerCustomer);
    })
    .map((p) => p.id);
}

export async function priceListRules(conn: DbOrTx, companyId: string): Promise<PriceListRule[]> {
  const lists = await conn.select().from(priceLists).where(and(eq(priceLists.companyId, companyId), eq(priceLists.isActive, true), isNull(priceLists.deactivatedAt)));
  if (!lists.length) return [];
  const items = await conn.select().from(priceListItems).where(inArray(priceListItems.priceListId, lists.map((l) => l.id)));
  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    adjustmentPercent: l.adjustmentPercent === null ? null : Number(l.adjustmentPercent),
    prices: Object.fromEntries(items.filter((i) => i.priceListId === l.id).map((i) => [i.variantId, i.price])),
  }));
}

// ---------------------------------------------------------------- Promociones (CRUD)

const optMoney = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v, c) => {
    if (v === null || v === undefined || v === "") return null;
    const cents = typeof v === "number" ? Math.round(v) : parseMoney(v);
    if (cents === null || cents < 0) {
      c.addIssue({ code: "custom", message: "Importe inválido" });
      return z.NEVER;
    }
    return cents;
  });
const optInt = z.union([z.string(), z.number(), z.null()]).optional().transform((v) => (v === null || v === undefined || v === "" ? null : Math.trunc(Number(v))));
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato HH:MM").optional().or(z.literal("")).nullable();
const isoDate = z.string().optional().or(z.literal("")).nullable();

export const promotionSchema = z
  .object({
    name: z.string().trim().min(3, "Escribe un nombre").max(80),
    description: z.string().trim().max(300).optional().or(z.literal("")),
    kind: z.enum(PROMOTION_KINDS),
    percent: z.union([z.string(), z.number(), z.null()]).optional().transform((v) => (v === null || v === undefined || v === "" ? null : Number(v))),
    amount: optMoney,
    buyQty: optInt,
    payQty: optInt,
    tiers: z.array(z.object({ minQty: z.coerce.number().positive(), percent: z.coerce.number().min(0).max(100) })).max(10).optional().default([]),
    bundle: z.array(z.object({ variantId: z.string().uuid(), qty: z.coerce.number().int().positive() })).max(10).optional().default([]),
    bundlePrice: optMoney,
    scope: z.enum(["all", "categories", "products"]),
    categoryIds: z.array(z.string().uuid()).max(200).default([]),
    productIds: z.array(z.string().uuid()).max(500).default([]),
    startsAt: isoDate,
    endsAt: isoDate,
    daysOfWeek: z.array(z.coerce.number().int().min(0).max(6)).max(7).default([]),
    timeFrom: hhmm,
    timeTo: hhmm,
    branchIds: z.array(z.string().uuid()).default([]),
    customerGroupIds: z.array(z.string().uuid()).default([]),
    requiresCoupon: z.boolean().default(false),
    minPurchase: optMoney,
    maxUses: optInt,
    maxUsesPerCustomer: optInt,
    priority: z.coerce.number().int().min(0).max(100).default(0),
    stackable: z.boolean().default(false),
  })
  .superRefine((v, c) => {
    const need = (cond: boolean, path: string, message: string) => !cond && c.addIssue({ code: "custom", path: [path], message });
    if (v.kind === "percent" || v.kind === "order_percent") need(v.percent !== null && v.percent > 0 && v.percent <= 100, "percent", "Porcentaje entre 0 y 100");
    if (v.kind === "amount" || v.kind === "special_price" || v.kind === "order_amount") need(v.amount !== null && (v.kind === "special_price" ? v.amount >= 0 : v.amount > 0), "amount", "Indica el importe");
    if (v.kind === "buy_x_pay_y") need(!!v.buyQty && !!v.payQty && v.buyQty >= 2 && v.payQty >= 1 && v.payQty < v.buyQty, "buyQty", "Lleva más de lo que paga (p. ej. lleva 2, paga 1)");
    if (v.kind === "volume") need(v.tiers.length > 0, "tiers", "Agrega al menos un tramo");
    if (v.kind === "bundle") {
      need(v.bundle.length >= 2, "bundle", "Un paquete tiene al menos 2 productos");
      need(v.bundlePrice !== null, "bundlePrice", "Indica el precio del paquete");
    }
    if (v.scope === "categories") need(v.categoryIds.length > 0, "categoryIds", "Elige al menos una categoría");
    if (v.scope === "products" && v.kind !== "bundle") need(v.productIds.length > 0, "productIds", "Elige al menos un producto");
    if (v.startsAt && v.endsAt) need(new Date(v.endsAt) > new Date(v.startsAt), "endsAt", "Termina antes de empezar");
    if (v.timeFrom && v.timeTo) need(v.timeTo > v.timeFrom, "timeTo", "La hora final debe ser posterior");
  });

/** Fecha local (AAAA-MM-DD) + zona de la empresa → instante; inicio o fin del día. */
function zonedDay(date: string, tz: string, end: boolean) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Date(date);
  const guess = new Date(`${date}T${end ? "23:59:59" : "00:00:00"}Z`);
  const offset = new Date(guess.toLocaleString("en-US", { timeZone: tz })).getTime() - new Date(guess.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return new Date(guess.getTime() - offset);
}

function toRow(ctx: ServiceContext, v: z.infer<typeof promotionSchema>) {
  const tz = requireCompany(ctx).timezone;
  const usesAmount = v.kind === "amount" || v.kind === "special_price" || v.kind === "order_amount";
  return {
    name: v.name,
    description: v.description || null,
    kind: v.kind,
    percent: v.kind === "percent" || v.kind === "order_percent" ? String(v.percent) : null,
    amount: usesAmount ? v.amount : null,
    buyQty: v.kind === "buy_x_pay_y" ? v.buyQty : null,
    payQty: v.kind === "buy_x_pay_y" ? v.payQty : null,
    tiers: v.kind === "volume" ? [...v.tiers].sort((a, b) => a.minQty - b.minQty) : null,
    bundle: v.kind === "bundle" ? v.bundle : null,
    bundlePrice: v.kind === "bundle" ? v.bundlePrice : null,
    scope: v.kind === "bundle" || v.kind === "order_percent" || v.kind === "order_amount" ? ("all" as const) : v.scope,
    categoryIds: v.scope === "categories" ? v.categoryIds : [],
    productIds: v.scope === "products" ? v.productIds : [],
    startsAt: v.startsAt ? zonedDay(v.startsAt, tz, false) : null,
    endsAt: v.endsAt ? zonedDay(v.endsAt, tz, true) : null,
    daysOfWeek: v.daysOfWeek,
    timeFrom: v.timeFrom || null,
    timeTo: v.timeTo || null,
    branchIds: v.branchIds,
    customerGroupIds: v.customerGroupIds,
    requiresCoupon: v.requiresCoupon,
    minPurchase: v.minPurchase,
    maxUses: v.maxUses,
    maxUsesPerCustomer: v.maxUsesPerCustomer,
    priority: v.priority,
    stackable: v.stackable,
  };
}

export async function createPromotion(ctx: ServiceContext, raw: unknown) {
  requirePermission(ctx, "promotions.manage");
  const company = requireCompany(ctx);
  const v = parseOrThrow(promotionSchema, raw);
  return db.transaction(async (tx) => {
    const [p] = await tx.insert(promotions).values({ tenantId: ctx.tenantId, companyId: company.id, ...toRow(ctx, v), createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
    await recordAudit(tx, ctx.actor, { action: "promotions.create", entity: "promotion", entityId: p.id, after: { name: p.name, kind: p.kind } });
    return p;
  });
}

export async function updatePromotion(ctx: ServiceContext, id: string, raw: unknown) {
  requirePermission(ctx, "promotions.manage");
  const before = await getPromotionRow(ctx, id);
  const v = parseOrThrow(promotionSchema, raw);
  return db.transaction(async (tx) => {
    const [p] = await tx.update(promotions).set({ ...toRow(ctx, v), updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(promotions.id, id)).returning();
    await recordAudit(tx, ctx.actor, { action: "promotions.update", entity: "promotion", entityId: id, before: toRule(before), after: toRule(p) });
    return p;
  });
}

export async function setPromotionActive(ctx: ServiceContext, id: string, active: boolean) {
  requirePermission(ctx, "promotions.manage");
  await getPromotionRow(ctx, id);
  await db.transaction(async (tx) => {
    await tx.update(promotions).set({ isActive: active, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(promotions.id, id));
    await recordAudit(tx, ctx.actor, { action: active ? "promotions.activate" : "promotions.pause", entity: "promotion", entityId: id });
  });
}

async function getPromotionRow(ctx: ServiceContext, id: string) {
  requirePermission(ctx, "promotions.view");
  const company = requireCompany(ctx);
  const [p] = await db.select().from(promotions).where(and(eq(promotions.id, id), eq(promotions.companyId, company.id))).limit(1);
  if (!p) throw new NotFoundError("La promoción");
  return p;
}

export async function listPromotions(ctx: ServiceContext) {
  requirePermission(ctx, "promotions.view");
  const company = requireCompany(ctx);
  return db
    .select({
      p: promotions,
      uses: sql<number>`(select count(*) from ${promotionRedemptions} r where r.promotion_id = ${promotions.id} and r.status = 'applied')`.mapWith(Number),
      discount: sql<number>`(select coalesce(sum(r.amount),0) from ${promotionRedemptions} r where r.promotion_id = ${promotions.id} and r.status = 'applied')`.mapWith(Number),
      coupons: sql<number>`(select count(*) from ${coupons} c where c.promotion_id = ${promotions.id})`.mapWith(Number),
    })
    .from(promotions)
    .where(eq(promotions.companyId, company.id))
    .orderBy(desc(promotions.isActive), desc(promotions.priority), asc(promotions.name));
}

export async function getPromotion(ctx: ServiceContext, id: string) {
  const p = await getPromotionRow(ctx, id);
  const [list, usage] = await Promise.all([
    db.select().from(coupons).where(eq(coupons.promotionId, id)).orderBy(desc(coupons.createdAt)).limit(500),
    db.select({ uses: sql<number>`count(*)`.mapWith(Number), discount: sql<number>`coalesce(sum(${promotionRedemptions.amount}),0)`.mapWith(Number) }).from(promotionRedemptions).where(and(eq(promotionRedemptions.promotionId, id), eq(promotionRedemptions.status, "applied"))),
  ]);
  const bundleIds = (p.bundle ?? []).map((b) => b.variantId);
  const refs = [...new Set([...p.productIds])];
  const [prodNames, bundleNames] = await Promise.all([
    refs.length ? db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, refs)) : Promise.resolve([]),
    bundleIds.length ? db.select({ id: productVariants.id, sku: productVariants.sku, name: products.name, variantName: productVariants.variantName }).from(productVariants).innerJoin(products, eq(products.id, productVariants.productId)).where(inArray(productVariants.id, bundleIds)) : Promise.resolve([]),
  ]);
  return { promotion: p, coupons: list, uses: usage[0]?.uses ?? 0, discount: usage[0]?.discount ?? 0, productNames: prodNames, bundleNames };
}

// ---------------------------------------------------------------- Cupones

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O ni 1/I

export const couponSchema = z.object({
  mode: z.enum(["single", "batch"]),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{4,30}$/, "4 a 30 letras, números o guiones").optional().or(z.literal("")),
  prefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{0,8}$/, "Hasta 8 letras o números").optional().or(z.literal("")),
  count: z.coerce.number().int().min(1).max(500).optional(),
  maxUses: optInt,
  expiresAt: isoDate,
});

/** Crea un cupón con código propio (p. ej. BIENVENIDA10, varios usos) o un lote de códigos únicos de un solo uso. */
export async function createCoupons(ctx: ServiceContext, promotionId: string, raw: unknown) {
  requirePermission(ctx, "promotions.manage");
  const company = requireCompany(ctx);
  const p = await getPromotionRow(ctx, promotionId);
  if (!p.requiresCoupon) throw new ConflictError("Marca la promoción como «requiere cupón» para crear códigos.");
  const v = parseOrThrow(couponSchema, raw);
  const expiresAt = v.expiresAt ? zonedDay(v.expiresAt, company.timezone, true) : null;
  const codes: string[] = [];
  if (v.mode === "single") {
    if (!v.code) throw new ValidationError({ code: ["Escribe el código."] }, "Escribe el código del cupón.");
    codes.push(v.code);
  } else {
    const n = v.count ?? 10;
    const seen = new Set<string>();
    while (seen.size < n) seen.add(`${v.prefix ? `${v.prefix}-` : ""}${Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("")}`);
    codes.push(...seen);
  }
  try {
    return await db.transaction(async (tx) => {
      const rows = await tx
        .insert(coupons)
        .values(codes.map((code) => ({ tenantId: ctx.tenantId, companyId: company.id, promotionId, code, maxUses: v.mode === "batch" ? 1 : v.maxUses, expiresAt, createdBy: ctx.userId, updatedBy: ctx.userId })))
        .returning();
      await recordAudit(tx, ctx.actor, { action: "promotions.coupons_create", entity: "promotion", entityId: promotionId, after: { count: rows.length, sample: rows.slice(0, 3).map((r) => r.code) } });
      return rows;
    });
  } catch (e) {
    if (((e as { cause?: { code?: string } }).cause ?? (e as { code?: string }))?.code === "23505") throw new ValidationError({ code: ["Ese código ya existe."] }, "Ese código de cupón ya existe.");
    throw e;
  }
}

export async function setCouponActive(ctx: ServiceContext, couponId: string, active: boolean) {
  requirePermission(ctx, "promotions.manage");
  const company = requireCompany(ctx);
  const [c] = await db.update(coupons).set({ isActive: active, updatedAt: new Date(), updatedBy: ctx.userId }).where(and(eq(coupons.id, couponId), eq(coupons.companyId, company.id))).returning();
  if (!c) throw new NotFoundError("El cupón");
  await recordAudit(db, ctx.actor, { action: active ? "promotions.coupon_activate" : "promotions.coupon_pause", entity: "coupon", entityId: couponId, after: { code: c.code } });
}

/** Valida un código en el POS (requiere conexión). */
export async function validateCoupon(ctx: ServiceContext, code: string, conn: DbOrTx = db) {
  requirePermission(ctx, "pos.sell");
  const company = requireCompany(ctx);
  const [row] = await conn
    .select({ c: coupons, p: promotions })
    .from(coupons)
    .innerJoin(promotions, eq(promotions.id, coupons.promotionId))
    .where(and(eq(coupons.companyId, company.id), sql`upper(${coupons.code}) = ${code.trim().toUpperCase()}`))
    .limit(1);
  if (!row) throw new NotFoundError("El cupón");
  if (!row.c.isActive) throw new ConflictError(`El cupón ${row.c.code} está desactivado.`);
  if (row.c.expiresAt && row.c.expiresAt < new Date()) throw new ConflictError(`El cupón ${row.c.code} venció.`);
  if (row.c.maxUses !== null && row.c.usedCount >= row.c.maxUses) throw new ConflictError(`El cupón ${row.c.code} ya se usó.`);
  if (!row.p.isActive || row.p.deactivatedAt) throw new ConflictError(`La promoción del cupón ${row.c.code} no está activa.`);
  return { couponId: row.c.id, code: row.c.code, promotionId: row.p.id, promotionName: row.p.name };
}

/** Registra los usos de promociones y cupones de una venta (dentro de su transacción). */
export async function recordRedemptions(
  tx: Tx,
  ctx: ServiceContext,
  input: { saleId: string; customerId: string | null; applied: Array<{ promotionId: string; amount: number; description: string }>; coupons: Array<{ couponId: string; promotionId: string }>; strict: boolean },
): Promise<string[]> {
  const company = requireCompany(ctx);
  const problems: string[] = [];
  if (!input.applied.length) return problems;
  const ids = input.applied.map((a) => a.promotionId);
  // Bloquea las promociones con límite para que dos ventas simultáneas no pasen del tope.
  const rows = await tx.select().from(promotions).where(inArray(promotions.id, ids)).orderBy(promotions.id).for("update");
  const exhausted = await exhaustedPromotionIds(tx, rows, input.customerId);
  for (const id of exhausted) {
    const name = rows.find((r) => r.id === id)?.name ?? id;
    if (input.strict) throw new ConflictError(`La promoción «${name}» ya alcanzó su límite de usos. Vuelve a cobrar.`);
    problems.push(`«${name}» excedió su límite de usos (venta sin conexión).`);
  }
  for (const a of input.applied) {
    const coupon = input.coupons.find((c) => c.promotionId === a.promotionId);
    if (coupon) {
      const [c] = await tx.select().from(coupons).where(eq(coupons.id, coupon.couponId)).for("update");
      if (c.maxUses !== null && c.usedCount >= c.maxUses) {
        if (input.strict) throw new ConflictError(`El cupón ${c.code} ya se usó.`);
        problems.push(`El cupón ${c.code} ya se había usado.`);
      }
      await tx.update(coupons).set({ usedCount: c.usedCount + 1 }).where(eq(coupons.id, c.id));
    }
    await tx.insert(promotionRedemptions).values({ tenantId: ctx.tenantId, companyId: company.id, promotionId: a.promotionId, couponId: coupon?.couponId ?? null, saleId: input.saleId, customerId: input.customerId, amount: a.amount, description: a.description });
  }
  return problems;
}

/** Al cancelar una venta: los usos se revierten y los cupones se liberan. */
export async function reverseRedemptionsForSale(tx: Tx, saleId: string) {
  const rows = await tx.select().from(promotionRedemptions).where(and(eq(promotionRedemptions.saleId, saleId), eq(promotionRedemptions.status, "applied")));
  for (const r of rows) {
    await tx.update(promotionRedemptions).set({ status: "reversed" }).where(eq(promotionRedemptions.id, r.id));
    if (r.couponId) await tx.update(coupons).set({ usedCount: sql`greatest(${coupons.usedCount} - 1, 0)` }).where(eq(coupons.id, r.couponId));
  }
}

// ---------------------------------------------------------------- Listas de precios

export const priceListSchema = z.object({
  name: z.string().trim().min(2, "Escribe un nombre").max(60),
  adjustmentPercent: z.union([z.string(), z.number(), z.null()]).optional().transform((v, c) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < -100 || n > 300) {
      c.addIssue({ code: "custom", message: "Entre −100 y 300" });
      return z.NEVER;
    }
    return n;
  }),
  isActive: z.boolean().default(true),
});

export async function listPriceLists(ctx: ServiceContext) {
  requirePermission(ctx, "promotions.view");
  const company = requireCompany(ctx);
  return db
    .select({
      l: priceLists,
      items: sql<number>`(select count(*) from ${priceListItems} i where i.price_list_id = ${priceLists.id})`.mapWith(Number),
      groups: sql<string>`(select string_agg(g.name, ', ') from ${customerGroups} g where g.price_list_id = ${priceLists.id} and g.deactivated_at is null)`,
    })
    .from(priceLists)
    .where(eq(priceLists.companyId, company.id))
    .orderBy(asc(priceLists.name));
}

export async function savePriceList(ctx: ServiceContext, id: string | null, raw: unknown) {
  requirePermission(ctx, "promotions.manage");
  const company = requireCompany(ctx);
  const v = parseOrThrow(priceListSchema, raw);
  try {
    return await db.transaction(async (tx) => {
      const values = { name: v.name, adjustmentPercent: v.adjustmentPercent === null ? null : String(v.adjustmentPercent), isActive: v.isActive, updatedAt: new Date(), updatedBy: ctx.userId };
      const [l] = id
        ? await tx.update(priceLists).set(values).where(and(eq(priceLists.id, id), eq(priceLists.companyId, company.id))).returning()
        : await tx.insert(priceLists).values({ ...values, tenantId: ctx.tenantId, companyId: company.id, createdBy: ctx.userId }).returning();
      if (!l) throw new NotFoundError("La lista de precios");
      await recordAudit(tx, ctx.actor, { action: id ? "promotions.price_list_update" : "promotions.price_list_create", entity: "price_list", entityId: l.id, after: { name: l.name, adjustmentPercent: l.adjustmentPercent, isActive: l.isActive } });
      return l;
    });
  } catch (e) {
    if (((e as { cause?: { code?: string } }).cause ?? (e as { code?: string }))?.code === "23505") throw new ValidationError({ name: ["Ya existe una lista con ese nombre."] }, "Ya existe una lista con ese nombre.");
    throw e;
  }
}

export async function getPriceList(ctx: ServiceContext, id: string) {
  requirePermission(ctx, "promotions.view");
  const company = requireCompany(ctx);
  const [l] = await db.select().from(priceLists).where(and(eq(priceLists.id, id), eq(priceLists.companyId, company.id))).limit(1);
  if (!l) throw new NotFoundError("La lista de precios");
  const items = await db
    .select({ i: priceListItems, sku: productVariants.sku, name: products.name, variantName: productVariants.variantName, basePrice: productVariants.price })
    .from(priceListItems)
    .innerJoin(productVariants, eq(productVariants.id, priceListItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(priceListItems.priceListId, id))
    .orderBy(asc(products.name));
  const groups = await db.select().from(customerGroups).where(and(eq(customerGroups.priceListId, id), isNull(customerGroups.deactivatedAt)));
  return { list: l, items, groups };
}

export const priceItemsSchema = z.object({ items: z.array(z.object({ variantId: z.string().uuid(), price: z.union([z.string(), z.number()]) })).max(2000) });

/** Reemplaza los precios fijos de la lista. */
export async function setPriceListItems(ctx: ServiceContext, id: string, raw: unknown) {
  requirePermission(ctx, "promotions.manage");
  const company = requireCompany(ctx);
  await getPriceList(ctx, id);
  const v = parseOrThrow(priceItemsSchema, raw);
  const rows = v.items.map((it, i) => {
    const cents = typeof it.price === "number" ? Math.round(it.price) : parseMoney(it.price);
    if (cents === null || cents < 0) throw new ValidationError({ [`items.${i}.price`]: ["Precio inválido"] }, "Revisa los precios.");
    return { variantId: it.variantId, price: cents };
  });
  if (new Set(rows.map((r) => r.variantId)).size !== rows.length) throw new ValidationError({ items: ["Producto repetido."] }, "Un producto aparece dos veces.");
  const valid = rows.length ? await db.select({ id: productVariants.id }).from(productVariants).where(and(eq(productVariants.companyId, company.id), inArray(productVariants.id, rows.map((r) => r.variantId)))) : [];
  if (valid.length !== rows.length) throw new NotFoundError("Algún producto");
  return db.transaction(async (tx) => {
    await tx.delete(priceListItems).where(eq(priceListItems.priceListId, id));
    if (rows.length) await tx.insert(priceListItems).values(rows.map((r) => ({ ...r, tenantId: ctx.tenantId, priceListId: id })));
    await recordAudit(tx, ctx.actor, { action: "promotions.price_list_items", entity: "price_list", entityId: id, after: { items: rows.length } });
    return rows.length;
  });
}
