/**
 * Motor de promociones. Código puro, compartido por el POS (navegador, también
 * sin conexión) y el servidor: con la misma entrada ambos obtienen el mismo
 * descuento por línea y la misma explicación.
 *
 * Reglas:
 * - Importes en centavos, en la misma base que el precio (con impuesto si el
 *   producto lo incluye). El descuento se resta antes de calcular impuestos.
 * - Se evalúa por prioridad (mayor primero). Las promociones de línea se
 *   aplican antes que las de ticket.
 * - Sin acumulación (o si la promoción no es acumulable), una línea que ya
 *   tiene promoción no recibe otra; las de ticket solo aplican si ninguna
 *   otra promoción aplicó.
 * - Un descuento nunca deja una línea por debajo de cero.
 */

export const PROMOTION_KINDS = ["percent", "amount", "special_price", "buy_x_pay_y", "volume", "bundle", "order_percent", "order_amount"] as const;
export type PromotionKind = (typeof PROMOTION_KINDS)[number];

export const PROMOTION_KIND_LABELS: Record<PromotionKind, string> = {
  percent: "Porcentaje de descuento",
  amount: "Descuento fijo por pieza",
  special_price: "Precio especial",
  buy_x_pay_y: "Lleva X, paga Y (2x1, 3x2)",
  volume: "Descuento por volumen",
  bundle: "Paquete / combo",
  order_percent: "Porcentaje sobre el ticket",
  order_amount: "Monto sobre el ticket",
};

export type PromotionRule = {
  id: string;
  name: string;
  kind: PromotionKind;
  /** Porcentaje (0–100) para percent / order_percent. */
  percent?: number | null;
  /** Centavos: descuento por pieza (amount), precio especial (special_price) o descuento al ticket (order_amount). */
  amount?: number | null;
  buyQty?: number | null;
  payQty?: number | null;
  tiers?: Array<{ minQty: number; percent: number }> | null;
  bundle?: Array<{ variantId: string; qty: number }> | null;
  bundlePrice?: number | null;
  scope: "all" | "categories" | "products";
  categoryIds?: string[] | null;
  productIds?: string[] | null;
  variantIds?: string[] | null;
  startsAt?: string | null;
  endsAt?: string | null;
  /** 0 = domingo … 6 = sábado. Vacío = todos. */
  daysOfWeek?: number[] | null;
  /** "HH:MM" en la zona horaria de la empresa. */
  timeFrom?: string | null;
  timeTo?: string | null;
  branchIds?: string[] | null;
  customerGroupIds?: string[] | null;
  requiresCoupon?: boolean;
  /** Compra mínima (centavos, sobre el importe de los productos). */
  minPurchase?: number | null;
  priority: number;
  stackable: boolean;
  active: boolean;
};

export type PromoItem = {
  key: string;
  variantId: string;
  productId: string;
  categoryId: string | null;
  quantity: number;
  unitPrice: number;
  /** Descuento manual ya aplicado a la línea (centavos). */
  manualDiscount?: number;
  /** Las cantidades fraccionarias (granel) no participan en 2x1 ni combos. */
  allowsDecimals?: boolean;
};

export type PromoContext = {
  now: Date;
  timezone: string;
  branchId: string;
  customerGroupId?: string | null;
  /** Promociones desbloqueadas por cupón (id de promoción). */
  couponPromotionIds?: string[];
  /** Promociones agotadas (por usos totales o por cliente); el servidor las calcula. */
  exhaustedPromotionIds?: string[];
  allowStacking: boolean;
};

export type AppliedPromotion = { promotionId: string; name: string; amount: number; description: string; lines: Record<string, number> };
export type PromoResult = { lineDiscounts: Record<string, number>; applied: AppliedPromotion[]; total: number };

const money = (c: number) => `$${(c / 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const round = (x: number) => Math.round(x);

/** Hora local de la empresa: día de la semana (0–6), "HH:MM" y fecha ISO. */
export function localParts(now: Date, timeZone: string) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hour = get("hour") === "24" ? "00" : get("hour");
  return { weekday: days.indexOf(get("weekday")), time: `${hour}:${get("minute")}`, date: `${get("year")}-${get("month")}-${get("day")}` };
}

/** ¿Aplica la promoción por fecha, día, hora, sucursal, grupo y cupón? (sin revisar productos ni monto). */
export function isEligible(p: PromotionRule, ctx: PromoContext): boolean {
  if (!p.active) return false;
  if (ctx.exhaustedPromotionIds?.includes(p.id)) return false;
  const t = ctx.now.getTime();
  if (p.startsAt && t < new Date(p.startsAt).getTime()) return false;
  if (p.endsAt && t > new Date(p.endsAt).getTime()) return false;
  const lp = localParts(ctx.now, ctx.timezone);
  if (p.daysOfWeek?.length && !p.daysOfWeek.includes(lp.weekday)) return false;
  if (p.timeFrom && lp.time < p.timeFrom) return false;
  if (p.timeTo && lp.time > p.timeTo) return false;
  if (p.branchIds?.length && !p.branchIds.includes(ctx.branchId)) return false;
  if (p.customerGroupIds?.length && (!ctx.customerGroupId || !p.customerGroupIds.includes(ctx.customerGroupId))) return false;
  if (p.requiresCoupon && !ctx.couponPromotionIds?.includes(p.id)) return false;
  return true;
}

function inScope(p: PromotionRule, it: PromoItem) {
  if (p.scope === "all") return true;
  if (p.scope === "categories") return !!it.categoryId && !!p.categoryIds?.includes(it.categoryId);
  return !!p.productIds?.includes(it.productId) || !!p.variantIds?.includes(it.variantId);
}

const isOrderLevel = (k: PromotionKind) => k === "order_percent" || k === "order_amount";

/** Reparte `amount` entre líneas en proporción a `weights` (el resto va a la de mayor peso). */
function allocate(amount: number, weights: Array<{ key: string; w: number }>): Record<string, number> {
  const total = weights.reduce((a, x) => a + x.w, 0);
  const out: Record<string, number> = {};
  if (total <= 0 || amount <= 0) return out;
  let given = 0;
  const sorted = [...weights].sort((a, b) => b.w - a.w);
  for (const x of sorted.slice(1)) {
    const v = Math.floor((amount * x.w) / total);
    out[x.key] = v;
    given += v;
  }
  out[sorted[0].key] = amount - given;
  return out;
}

/**
 * Calcula las promociones de una venta. Devuelve el descuento por línea
 * (`key` del artículo) y la lista de promociones aplicadas con explicación.
 */
export function evaluatePromotions(items: PromoItem[], promotions: PromotionRule[], ctx: PromoContext): PromoResult {
  const gross = new Map(items.map((it) => [it.key, round(it.unitPrice * it.quantity)]));
  const remaining = new Map(items.map((it) => [it.key, Math.max(0, gross.get(it.key)! - (it.manualDiscount ?? 0))]));
  const promoted = new Set<string>();
  const lineDiscounts: Record<string, number> = {};
  const applied: AppliedPromotion[] = [];
  const subtotal = items.reduce((a, it) => a + gross.get(it.key)!, 0);

  const eligible = promotions
    .filter((p) => isEligible(p, ctx))
    .filter((p) => !p.minPurchase || subtotal >= p.minPurchase)
    .sort((a, b) => b.priority - a.priority || Number(isOrderLevel(a.kind)) - Number(isOrderLevel(b.kind)) || a.id.localeCompare(b.id));
  const lineLevel = eligible.filter((p) => !isOrderLevel(p.kind));
  const orderLevel = eligible.filter((p) => isOrderLevel(p.kind));

  const give = (p: PromotionRule, perLine: Record<string, number>, description: string) => {
    const clean: Record<string, number> = {};
    let sum = 0;
    for (const [k, v0] of Object.entries(perLine)) {
      const v = Math.min(Math.max(0, round(v0)), remaining.get(k) ?? 0);
      if (v <= 0) continue;
      clean[k] = v;
      sum += v;
      remaining.set(k, remaining.get(k)! - v);
      lineDiscounts[k] = (lineDiscounts[k] ?? 0) + v;
      promoted.add(k);
    }
    if (sum > 0) applied.push({ promotionId: p.id, name: p.name, amount: sum, description: `${description}: −${money(sum)}`, lines: clean });
  };

  for (const p of lineLevel) {
    const canStack = ctx.allowStacking && p.stackable;
    const lines = items.filter((it) => inScope(p, it) && (remaining.get(it.key) ?? 0) > 0 && (canStack || !promoted.has(it.key)));
    if (!lines.length) continue;
    const per: Record<string, number> = {};
    switch (p.kind) {
      case "percent": {
        const pct = Math.min(100, Math.max(0, p.percent ?? 0));
        for (const it of lines) per[it.key] = (remaining.get(it.key)! * pct) / 100;
        give(p, per, `${p.name} (${pct} %)`);
        break;
      }
      case "amount": {
        for (const it of lines) per[it.key] = Math.min((p.amount ?? 0) * it.quantity, remaining.get(it.key)!);
        give(p, per, `${p.name} (${money(p.amount ?? 0)} c/u)`);
        break;
      }
      case "special_price": {
        const price = p.amount ?? 0;
        for (const it of lines) {
          const unitNow = remaining.get(it.key)! / it.quantity;
          if (unitNow > price) per[it.key] = (unitNow - price) * it.quantity;
        }
        give(p, per, `${p.name} (a ${money(price)})`);
        break;
      }
      case "buy_x_pay_y": {
        const x = p.buyQty ?? 0, y = p.payQty ?? 0;
        if (x < 2 || y < 1 || y >= x) break;
        // Piezas enteras de las líneas en promoción; las más baratas salen gratis.
        const units: Array<{ key: string; price: number }> = [];
        for (const it of lines) {
          if (it.allowsDecimals && !Number.isInteger(it.quantity)) continue;
          const unit = remaining.get(it.key)! / it.quantity;
          for (let i = 0; i < Math.floor(it.quantity); i++) units.push({ key: it.key, price: unit });
        }
        const free = Math.floor(units.length / x) * (x - y);
        units.sort((a, b) => a.price - b.price || a.key.localeCompare(b.key));
        for (const u of units.slice(0, free)) per[u.key] = (per[u.key] ?? 0) + u.price;
        give(p, per, `${p.name} (${x}x${y})`);
        break;
      }
      case "volume": {
        const qty = lines.reduce((a, it) => a + it.quantity, 0);
        const tier = [...(p.tiers ?? [])].sort((a, b) => b.minQty - a.minQty).find((t) => qty >= t.minQty);
        if (!tier) break;
        for (const it of lines) per[it.key] = (remaining.get(it.key)! * tier.percent) / 100;
        give(p, per, `${p.name} (${tier.percent} % desde ${tier.minQty} pzas.)`);
        break;
      }
      case "bundle": {
        const comps = p.bundle ?? [];
        if (!comps.length || p.bundlePrice === null || p.bundlePrice === undefined) break;
        const byVariant = new Map(lines.map((it) => [it.variantId, it]));
        let sets = Infinity;
        for (const c of comps) {
          const it = byVariant.get(c.variantId);
          sets = Math.min(sets, it ? Math.floor(it.quantity / c.qty) : 0);
        }
        if (!sets || !Number.isFinite(sets)) break;
        const regular = comps.map((c) => {
          const it = byVariant.get(c.variantId)!;
          return { key: it.key, w: (remaining.get(it.key)! / it.quantity) * c.qty * sets };
        });
        const regularTotal = regular.reduce((a, r) => a + r.w, 0);
        const discount = round(regularTotal - p.bundlePrice * sets);
        if (discount <= 0) break;
        give(p, allocate(discount, regular), `${p.name} (${sets} paquete${sets > 1 ? "s" : ""} a ${money(p.bundlePrice)})`);
        break;
      }
    }
  }

  for (const p of orderLevel) {
    const canStack = ctx.allowStacking && p.stackable;
    if (!canStack && applied.length) continue;
    const weights = items.filter((it) => (remaining.get(it.key) ?? 0) > 0 && (canStack || !promoted.has(it.key))).map((it) => ({ key: it.key, w: remaining.get(it.key)! }));
    const base = weights.reduce((a, w) => a + w.w, 0);
    if (!base) continue;
    const amount = p.kind === "order_percent" ? round((base * Math.min(100, Math.max(0, p.percent ?? 0))) / 100) : Math.min(p.amount ?? 0, base);
    give(p, allocate(amount, weights), p.kind === "order_percent" ? `${p.name} (${p.percent} % del ticket)` : p.name);
  }

  return { lineDiscounts, applied, total: applied.reduce((a, x) => a + x.amount, 0) };
}

/** Precio de una variante según la lista de precios (precio fijo o ajuste porcentual). */
export type PriceListRule = { id: string; name: string; adjustmentPercent: number | null; prices: Record<string, number> };
export function listPrice(list: PriceListRule | null | undefined, variantId: string, basePrice: number): number {
  if (!list) return basePrice;
  const fixed = list.prices[variantId];
  if (fixed !== undefined) return fixed;
  if (list.adjustmentPercent) return Math.max(0, round(basePrice * (1 + list.adjustmentPercent / 100)));
  return basePrice;
}
