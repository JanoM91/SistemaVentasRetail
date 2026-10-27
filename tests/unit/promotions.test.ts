import { describe, expect, it } from "vitest";
import { evaluatePromotions, isEligible, listPrice, localParts, type PromoContext, type PromoItem, type PromotionRule } from "@/lib/promotions";

const base = (p: Partial<PromotionRule> & Pick<PromotionRule, "id" | "kind">): PromotionRule => ({ name: p.id, scope: "all", priority: 0, stackable: false, active: true, ...p });
const item = (key: string, unitPrice: number, quantity: number, extra: Partial<PromoItem> = {}): PromoItem => ({ key, variantId: key, productId: `p-${key}`, categoryId: "bebidas", unitPrice, quantity, ...extra });
// Martes 27-oct-2026 12:00 en Ciudad de México (18:00 UTC).
const ctx = (extra: Partial<PromoContext> = {}): PromoContext => ({ now: new Date("2026-10-27T18:00:00Z"), timezone: "America/Mexico_City", branchId: "b1", allowStacking: false, ...extra });

describe("motor de promociones", () => {
  it("porcentaje por categoría con explicación", () => {
    const r = evaluatePromotions([item("coca", 1850, 2), item("pan", 4000, 1, { categoryId: "panaderia" })], [base({ id: "p1", name: "Bebidas 10%", kind: "percent", percent: 10, scope: "categories", categoryIds: ["bebidas"] })], ctx());
    expect(r.lineDiscounts).toEqual({ coca: 370 });
    expect(r.applied[0].description).toBe("Bebidas 10% (10 %): −$3.70");
  });

  it("2x1 y 3x2: las piezas más baratas salen gratis, sin contar granel", () => {
    const p = base({ id: "2x1", name: "2x1", kind: "buy_x_pay_y", buyQty: 2, payQty: 1, scope: "products", productIds: ["p-a", "p-b"] });
    const r = evaluatePromotions([item("a", 2000, 2), item("b", 1500, 1)], [p], ctx());
    // 3 piezas → 1 grupo de 2 → la más barata (15.00) gratis.
    expect(r.lineDiscounts).toEqual({ b: 1500 });
    const r2 = evaluatePromotions([item("a", 2000, 4)], [p], ctx());
    expect(r2.lineDiscounts).toEqual({ a: 4000 });
    const r3 = evaluatePromotions([item("a", 1000, 6)], [base({ id: "3x2", kind: "buy_x_pay_y", buyQty: 3, payQty: 2 })], ctx());
    expect(r3.total).toBe(2000);
    const r4 = evaluatePromotions([item("g", 3000, 2.5, { allowsDecimals: true })], [base({ id: "2x1", kind: "buy_x_pay_y", buyQty: 2, payQty: 1 })], ctx());
    expect(r4.total).toBe(0);
  });

  it("volumen por tramos, precio especial y monto por pieza", () => {
    const vol = base({ id: "vol", kind: "volume", tiers: [{ minQty: 6, percent: 5 }, { minQty: 12, percent: 10 }] });
    expect(evaluatePromotions([item("a", 1000, 5)], [vol], ctx()).total).toBe(0);
    expect(evaluatePromotions([item("a", 1000, 6)], [vol], ctx()).total).toBe(300);
    expect(evaluatePromotions([item("a", 1000, 12)], [vol], ctx()).total).toBe(1200);
    expect(evaluatePromotions([item("a", 1850, 3)], [base({ id: "sp", kind: "special_price", amount: 1500 })], ctx()).total).toBe(1050);
    expect(evaluatePromotions([item("a", 1200, 1)], [base({ id: "sp", kind: "special_price", amount: 1500 })], ctx()).total).toBe(0);
    expect(evaluatePromotions([item("a", 300, 2)], [base({ id: "am", kind: "amount", amount: 500 })], ctx()).total).toBe(600);
  });

  it("combo: precio fijo por paquete completo, repartido entre componentes", () => {
    const combo = base({ id: "combo", name: "Torta + refresco", kind: "bundle", bundle: [{ variantId: "torta", qty: 1 }, { variantId: "coca", qty: 1 }], bundlePrice: 6000 });
    const r = evaluatePromotions([item("torta", 5500, 2), item("coca", 1850, 1)], [combo], ctx());
    // Solo 1 paquete completo: 55 + 18.50 = 73.50 → 60 = 13.50 de descuento.
    expect(r.total).toBe(1350);
    expect(r.lineDiscounts.torta + r.lineDiscounts.coca).toBe(1350);
    expect(r.applied[0].description).toContain("1 paquete a $60.00");
  });

  it("sin acumulación: la de mayor prioridad gana por línea; la de ticket solo si nada más aplicó", () => {
    const p10 = base({ id: "p10", kind: "percent", percent: 10, priority: 1 });
    const p50 = base({ id: "p50", kind: "percent", percent: 50, priority: 5, scope: "products", productIds: ["p-a"] });
    const ticket = base({ id: "t", kind: "order_amount", amount: 1000, minPurchase: 1000 });
    const r = evaluatePromotions([item("a", 1000, 1), item("b", 1000, 1)], [p10, p50, ticket], ctx());
    expect(r.lineDiscounts).toEqual({ a: 500, b: 100 });
    expect(r.applied.map((x) => x.promotionId)).toEqual(["p50", "p10"]);
    // Con acumulación permitida y promociones acumulables, se suman.
    const s = evaluatePromotions([item("a", 1000, 1), item("b", 1000, 1)], [{ ...p10, stackable: true }, { ...p50, stackable: true }, { ...ticket, stackable: true }], ctx({ allowStacking: true }));
    expect(s.lineDiscounts.a).toBe(500 + 50 + 333); // 50 % → 10 % de lo restante → $10 repartido 450:900
    expect(s.total).toBe(500 + 50 + 100 + 1000);
  });

  it("descuento al ticket repartido por línea sin perder centavos; respeta el descuento manual", () => {
    const r = evaluatePromotions([item("a", 333, 1), item("b", 333, 1), item("c", 334, 1, { manualDiscount: 34 })], [base({ id: "t", kind: "order_percent", percent: 10 })], ctx());
    expect(r.total).toBe(97); // 10 % de 9.66
    expect(Object.values(r.lineDiscounts).reduce((a, b) => a + b, 0)).toBe(97);
  });

  it("condiciones: vigencia, días, horario, sucursal, grupo, cupón, mínimo y agotadas", () => {
    const p = base({ id: "x", kind: "percent", percent: 10 });
    expect(localParts(new Date("2026-10-27T18:00:00Z"), "America/Mexico_City")).toEqual({ weekday: 2, time: "12:00", date: "2026-10-27" });
    expect(isEligible({ ...p, endsAt: "2026-10-26T00:00:00Z" }, ctx())).toBe(false);
    expect(isEligible({ ...p, startsAt: "2026-10-28T00:00:00Z" }, ctx())).toBe(false);
    expect(isEligible({ ...p, daysOfWeek: [2] }, ctx())).toBe(true);
    expect(isEligible({ ...p, daysOfWeek: [0, 6] }, ctx())).toBe(false);
    expect(isEligible({ ...p, timeFrom: "13:00", timeTo: "15:00" }, ctx())).toBe(false);
    expect(isEligible({ ...p, timeFrom: "11:00", timeTo: "13:00" }, ctx())).toBe(true);
    expect(isEligible({ ...p, branchIds: ["b2"] }, ctx())).toBe(false);
    expect(isEligible({ ...p, customerGroupIds: ["mayoreo"] }, ctx())).toBe(false);
    expect(isEligible({ ...p, customerGroupIds: ["mayoreo"] }, ctx({ customerGroupId: "mayoreo" }))).toBe(true);
    expect(isEligible({ ...p, requiresCoupon: true }, ctx())).toBe(false);
    expect(isEligible({ ...p, requiresCoupon: true }, ctx({ couponPromotionIds: ["x"] }))).toBe(true);
    expect(isEligible(p, ctx({ exhaustedPromotionIds: ["x"] }))).toBe(false);
    expect(isEligible({ ...p, active: false }, ctx())).toBe(false);
    expect(evaluatePromotions([item("a", 500, 1)], [{ ...p, minPurchase: 1000 }], ctx()).total).toBe(0);
  });

  it("lista de precios: precio fijo o ajuste porcentual", () => {
    const l = { id: "l", name: "Mayoreo", adjustmentPercent: -10, prices: { coca: 1600 } };
    expect(listPrice(l, "coca", 1850)).toBe(1600);
    expect(listPrice(l, "pan", 4000)).toBe(3600);
    expect(listPrice(null, "pan", 4000)).toBe(4000);
  });
});
