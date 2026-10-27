import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { branches, categories, customerGroups, type promotions } from "@/server/db/schema";
import type { RequestContext } from "@/server/context";
import { requireCompany } from "@/server/service-context";
import { PROMOTION_KIND_LABELS } from "@/lib/promotions";
import { EMPTY_PROMOTION, type PromotionFormValues } from "./promotion-values";

export async function promotionFormOptions(ctx: RequestContext) {
  const company = requireCompany(ctx);
  const [cats, brs, grs] = await Promise.all([
    db.select({ id: categories.id, name: categories.name }).from(categories).where(and(eq(categories.companyId, company.id), isNull(categories.deactivatedAt))).orderBy(asc(categories.name)),
    db.select({ id: branches.id, name: branches.name }).from(branches).where(and(eq(branches.companyId, company.id), isNull(branches.deactivatedAt))).orderBy(asc(branches.name)),
    db.select({ id: customerGroups.id, name: customerGroups.name }).from(customerGroups).where(and(eq(customerGroups.companyId, company.id), isNull(customerGroups.deactivatedAt))).orderBy(asc(customerGroups.name)),
  ]);
  return { categories: cats, branches: brs, groups: grs };
}

const dateIn = (d: Date | null, tz: string) => (d ? new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d) : "");
const m = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));

export function toFormValues(p: typeof promotions.$inferSelect, tz: string, productNames: Array<{ id: string; name: string }>, bundleNames: Array<{ id: string; name: string; variantName: string }>): PromotionFormValues {
  return {
    ...EMPTY_PROMOTION,
    name: p.name,
    description: p.description ?? "",
    kind: p.kind,
    percent: p.percent ? String(Number(p.percent)) : "",
    amount: m(p.amount),
    buyQty: p.buyQty ? String(p.buyQty) : "2",
    payQty: p.payQty ? String(p.payQty) : "1",
    tiers: (p.tiers ?? []).map((t) => ({ minQty: String(t.minQty), percent: String(t.percent) })),
    bundle: (p.bundle ?? []).map((b) => {
      const n = bundleNames.find((x) => x.id === b.variantId);
      return { variantId: b.variantId, qty: String(b.qty), label: n ? `${n.name}${n.variantName ? ` · ${n.variantName}` : ""}` : b.variantId };
    }),
    bundlePrice: m(p.bundlePrice),
    scope: p.scope,
    categoryIds: p.categoryIds,
    products: p.productIds.map((id) => ({ id, name: productNames.find((x) => x.id === id)?.name ?? "(producto)" })),
    startsAt: dateIn(p.startsAt, tz),
    endsAt: dateIn(p.endsAt, tz),
    daysOfWeek: p.daysOfWeek,
    timeFrom: p.timeFrom ?? "",
    timeTo: p.timeTo ?? "",
    branchIds: p.branchIds,
    customerGroupIds: p.customerGroupIds,
    requiresCoupon: p.requiresCoupon,
    minPurchase: m(p.minPurchase),
    maxUses: p.maxUses ? String(p.maxUses) : "",
    maxUsesPerCustomer: p.maxUsesPerCustomer ? String(p.maxUsesPerCustomer) : "",
    priority: String(p.priority),
    stackable: p.stackable,
  };
}

const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** Resumen en una línea: «2x1 · Bebidas · lun, mar · 14:00–18:00 · con cupón». */
export function summarize(p: typeof promotions.$inferSelect, currency: string, tz: string) {
  const money = (c: number | null) => (c === null ? "" : new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(c / 100));
  const what =
    p.kind === "percent" ? `${Number(p.percent)} %` :
    p.kind === "amount" ? `${money(p.amount)} menos por pieza` :
    p.kind === "special_price" ? `a ${money(p.amount)}` :
    p.kind === "buy_x_pay_y" ? `${p.buyQty}x${p.payQty}` :
    p.kind === "volume" ? (p.tiers ?? []).map((t) => `${t.percent} % desde ${t.minQty}`).join(", ") :
    p.kind === "bundle" ? `paquete a ${money(p.bundlePrice)}` :
    p.kind === "order_percent" ? `${Number(p.percent)} % del ticket` : `${money(p.amount)} al ticket`;
  const parts = [what];
  if (p.scope === "categories") parts.push(`${p.categoryIds.length} categoría(s)`);
  if (p.scope === "products") parts.push(`${p.productIds.length} producto(s)`);
  if (p.daysOfWeek.length) parts.push(p.daysOfWeek.map((d) => DAYS[d]).join(", "));
  if (p.timeFrom || p.timeTo) parts.push(`${p.timeFrom ?? "00:00"}–${p.timeTo ?? "23:59"}`);
  if (p.startsAt || p.endsAt) parts.push(`${p.startsAt ? dateIn(p.startsAt, tz) : "…"} a ${p.endsAt ? dateIn(p.endsAt, tz) : "…"}`);
  if (p.minPurchase) parts.push(`compra mín. ${money(p.minPurchase)}`);
  if (p.customerGroupIds.length) parts.push("grupos de clientes");
  if (p.requiresCoupon) parts.push("con cupón");
  return { kindLabel: PROMOTION_KIND_LABELS[p.kind], text: parts.join(" · ") };
}

/** Estado según vigencia. */
export function promoStatus(p: typeof promotions.$inferSelect, used: number) {
  const now = Date.now();
  if (!p.isActive) return { tone: "neutral", label: "Pausada" } as const;
  if (p.endsAt && p.endsAt.getTime() < now) return { tone: "neutral", label: "Terminada" } as const;
  if (p.startsAt && p.startsAt.getTime() > now) return { tone: "info", label: "Programada" } as const;
  if (p.maxUses && used >= p.maxUses) return { tone: "warning", label: "Agotada" } as const;
  return { tone: "success", label: "Vigente" } as const;
}
