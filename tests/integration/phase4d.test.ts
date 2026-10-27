import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "@/lib/pos/local-db";
import { db } from "@/server/db";
import { companyModules, coupons, MODULE_KEYS, paymentMethods, promotionRedemptions, taxProfiles, unitsOfMeasure } from "@/server/db/schema";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { createProduct } from "@/server/modules/catalog/service";
import { openSession } from "@/server/modules/cash/service";
import { cancelSale, createSale, getSale } from "@/server/modules/sales/service";
import { toTicketData } from "@/server/modules/sales/ticket";
import { createCustomer, saveGroup } from "@/server/modules/customers/service";
import { getPosCatalog } from "@/server/modules/pos/catalog";
import { createCoupons, createPromotion, getPromotion, savePriceList, setPriceListItems, setPromotionActive, validateCoupon } from "@/server/modules/promotions/service";
import { listForReview, markSaleReviewed, savePaymentMethod, saveTaxProfile } from "@/server/modules/settings/service";
import { contextFor, createTenantFixture, resetDatabase, type Fixture } from "../helpers";

type Ctx = Awaited<ReturnType<typeof contextFor>>;

describe("Fase 4D · promociones, cupones y listas de precios", () => {
  let f: Fixture;
  let owner: Ctx;
  let manager: Ctx;
  let cashier: Ctx;
  let coca: { id: string; productId: string };
  let pan: { id: string; productId: string };
  let cash: string;

  const sell = (ctx: Ctx, o: { lines: Array<{ v: { id: string }; qty: number; price: number; promo?: number }>; total: number; customerId?: string; couponCodes?: string[]; offline?: boolean }) =>
    createSale(
      ctx,
      { id: uuidv7(), cashRegisterId: f.register.id, customerId: o.customerId, couponCodes: o.couponCodes, lines: o.lines.map((l) => ({ variantId: l.v.id, quantity: l.qty, unitPrice: l.price, discount: 0, promoDiscount: l.promo ?? 0 })), payments: [{ paymentMethodId: cash, amount: o.total }] },
      { origin: o.offline ? "offline" : "online" },
    );

  beforeEach(async () => {
    await resetDatabase();
    f = await createTenantFixture();
    for (const mod of MODULE_KEYS) await db.insert(companyModules).values({ companyId: f.company.id, module: mod, enabled: true }).onConflictDoUpdate({ target: [companyModules.companyId, companyModules.module], set: { enabled: true } });
    owner = await contextFor(f.owner);
    manager = await contextFor(f.manager);
    cashier = await contextFor(f.cashier);
    const [iva] = await db.select().from(taxProfiles).where(and(eq(taxProfiles.companyId, f.company.id), eq(taxProfiles.code, "IVA16")));
    const [pza] = await db.select().from(unitsOfMeasure).where(and(eq(unitsOfMeasure.companyId, f.company.id), eq(unitsOfMeasure.code, "PZA")));
    const mk = async (sku: string, price: string) => {
      const p = await createProduct(owner, { name: sku, sku, kind: "simple", unitId: pza.id, taxProfileId: iva.id, variants: [{ sku, price, cost: "5", initialStock: 100 }] });
      return { id: p.variants[0].id, productId: p.product.id };
    };
    coca = await mk("COCA", "18.50");
    pan = await mk("PAN", "40.00");
    [{ id: cash }] = await db.select({ id: paymentMethods.id }).from(paymentMethods).where(and(eq(paymentMethods.companyId, f.company.id), eq(paymentMethods.code, "EFECTIVO")));
    await openSession(cashier, { cashRegisterId: f.register.id, openingAmount: "500" });
  });

  it("2x1: el servidor recalcula, registra el uso y el ticket explica el ahorro; si no coincide, rechaza en línea", async () => {
    await expect(createPromotion(cashier, { name: "2x1", kind: "buy_x_pay_y", buyQty: 2, payQty: 1, scope: "products", productIds: [coca.productId] })).rejects.toThrow(ForbiddenError);
    await expect(createPromotion(manager, { name: "Mal", kind: "buy_x_pay_y", buyQty: 2, payQty: 2, scope: "all" })).rejects.toThrow(ValidationError);
    const p = await createPromotion(manager, { name: "2x1 Coca", kind: "buy_x_pay_y", buyQty: 2, payQty: 1, scope: "products", productIds: [coca.productId] });
    const cat = await getPosCatalog(cashier);
    expect(cat.promotions.map((r) => r.id)).toEqual([p.id]);
    await expect(sell(cashier, { lines: [{ v: coca, qty: 2, price: 1850 }], total: 3700 })).rejects.toMatchObject({ code: "promotions_changed" });
    const s = await sell(cashier, { lines: [{ v: coca, qty: 2, price: 1850, promo: 1850 }], total: 1850 });
    expect(s.sale.total).toBe(1850);
    expect(s.sale.discountTotal).toBe(1850);
    const d = await getSale(cashier, s.sale.id);
    expect(d.lines[0].promotionDiscount).toBe(1850);
    expect(toTicketData(d).promotions).toEqual([{ description: "2x1 Coca (2x1): −$18.50", amount: 1850 }]);
    expect((await getPromotion(manager, p.id)).uses).toBe(1);
    // Sin conexión con promociones distintas: se respeta lo cobrado y se marca.
    const off = await sell(cashier, { offline: true, lines: [{ v: coca, qty: 2, price: 1850 }], total: 3700 });
    expect(off.flags.map((x) => x.code)).toContain("promotion_mismatch");
    expect(off.sale.total).toBe(3700);
    // Pausada ya no aplica.
    await setPromotionActive(manager, p.id, false);
    expect((await sell(cashier, { lines: [{ v: coca, qty: 2, price: 1850 }], total: 3700 })).sale.total).toBe(3700);
  });

  it("cupón de un solo uso: valida, se consume con la venta y se libera al cancelarla; límite total de usos", async () => {
    const p = await createPromotion(manager, { name: "Bienvenida 10%", kind: "order_percent", percent: 10, scope: "all", requiresCoupon: true });
    await expect(createCoupons(manager, p.id, { mode: "single", code: "x" })).rejects.toThrow(ValidationError);
    const [c] = await createCoupons(manager, p.id, { mode: "single", code: "bienvenida", maxUses: 1 });
    expect(c.code).toBe("BIENVENIDA");
    const batch = await createCoupons(manager, p.id, { mode: "batch", prefix: "VIP", count: 5 });
    expect(new Set(batch.map((b) => b.code)).size).toBe(5);
    expect(batch[0].code).toMatch(/^VIP-[A-Z2-9]{6}$/);
    expect((await validateCoupon(cashier, "Bienvenida")).promotionId).toBe(p.id);
    // Sin el cupón la promoción no aplica.
    expect((await sell(cashier, { lines: [{ v: pan, qty: 1, price: 4000 }], total: 4000 })).sale.total).toBe(4000);
    const s = await sell(cashier, { couponCodes: ["bienvenida"], lines: [{ v: pan, qty: 1, price: 4000, promo: 400 }], total: 3600 });
    expect((await db.select().from(coupons).where(eq(coupons.id, c.id)))[0].usedCount).toBe(1);
    await expect(validateCoupon(cashier, "BIENVENIDA")).rejects.toThrow(/ya se usó/);
    await cancelSale(manager, s.sale.id, { reason: "Prueba de cupón" });
    expect((await db.select().from(coupons).where(eq(coupons.id, c.id)))[0].usedCount).toBe(0);
    expect((await db.select().from(promotionRedemptions).where(eq(promotionRedemptions.saleId, s.sale.id)))[0].status).toBe("reversed");
    // Límite total: 1 uso.
    const once = await createPromotion(manager, { name: "Primera compra", kind: "order_amount", amount: "5", scope: "all", maxUses: 1, priority: 10 });
    await sell(cashier, { lines: [{ v: pan, qty: 1, price: 4000, promo: 500 }], total: 3500 });
    expect((await getPosCatalog(cashier)).exhaustedPromotionIds).toContain(once.id);
    expect((await sell(cashier, { lines: [{ v: pan, qty: 1, price: 4000 }], total: 4000 })).sale.total).toBe(4000);
  });

  it("lista de precios por grupo y promoción exclusiva del grupo", async () => {
    const list = await savePriceList(manager, null, { name: "Mayoreo", adjustmentPercent: "-10" });
    await setPriceListItems(manager, list.id, { items: [{ variantId: coca.id, price: "16.00" }] });
    const g = await saveGroup(manager, null, { name: "Mayoreo", priceListId: list.id });
    const c = await createCustomer(cashier, { name: "Abarrotes Lupita", groupId: g.id });
    // Precio de lista: COCA fijo 16.00, PAN −10 % = 36.00.
    const s = await sell(cashier, { customerId: c.id, lines: [{ v: coca, qty: 1, price: 1600 }, { v: pan, qty: 1, price: 3600 }], total: 5200 });
    expect(s.sale.total).toBe(5200);
    await expect(sell(cashier, { customerId: c.id, lines: [{ v: coca, qty: 1, price: 1850 }], total: 1850 })).rejects.toMatchObject({ code: "price_changed" });
    await expect(sell(cashier, { lines: [{ v: coca, qty: 1, price: 1600 }], total: 1600 })).rejects.toMatchObject({ code: "price_changed" });
    // Promoción solo para el grupo.
    await createPromotion(manager, { name: "Mayoristas 5%", kind: "percent", percent: 5, scope: "all", customerGroupIds: [g.id] });
    expect((await sell(cashier, { lines: [{ v: pan, qty: 1, price: 4000 }], total: 4000 })).sale.total).toBe(4000);
    expect((await sell(cashier, { customerId: c.id, lines: [{ v: pan, qty: 1, price: 3600, promo: 180 }], total: 3420 })).sale.total).toBe(3420);
    // Sin el módulo de promociones, no aplican.
    await db.update(companyModules).set({ enabled: false }).where(and(eq(companyModules.companyId, f.company.id), eq(companyModules.module, "promotions")));
    const off = await contextFor(f.cashier);
    expect((await sell(off, { customerId: c.id, lines: [{ v: pan, qty: 1, price: 3600 }], total: 3600 })).sale.total).toBe(3600);
    expect((await getPosCatalog(off)).promotions).toEqual([]);
  });

  it("métodos de pago e impuestos editables; revisión de ventas con observaciones", async () => {
    await expect(savePaymentMethod(manager, null, { name: "QR", kind: "qr" })).rejects.toThrow(ForbiddenError);
    const qr = await savePaymentMethod(owner, null, { name: "Mercado Pago QR", kind: "qr", requiresReference: "on", isActive: "on" });
    expect(qr.code).toBe("MERCADO_PAGO_QR");
    expect((await getPosCatalog(cashier)).paymentMethods.some((m) => m.id === qr.id)).toBe(true);
    await expect(savePaymentMethod(owner, cash, { name: "Efectivo", isActive: "" })).rejects.toThrow(/al menos un método de efectivo/);
    await savePaymentMethod(owner, qr.id, { name: "QR", isActive: "" });
    expect((await getPosCatalog(cashier)).paymentMethods.some((m) => m.id === qr.id)).toBe(false);
    const [iva] = await db.select().from(taxProfiles).where(and(eq(taxProfiles.companyId, f.company.id), eq(taxProfiles.code, "IVA16")));
    const r = await saveTaxProfile(owner, iva.id, { name: "IVA 8 % frontera", kind: "iva", ratePercent: "8", isIncludedInPrice: "on", isDefault: "on" });
    expect(r.tax.rate).toBe("0.080000");
    expect(r.productsAffected).toBe(2);
    await expect(saveTaxProfile(owner, null, { code: "IVA16", name: "IVA repetido", kind: "iva", ratePercent: "16" })).rejects.toThrow(/ya existe/);
    // Venta sin conexión con observación → aparece en revisión hasta que se marca revisada.
    const off = await sell(cashier, { offline: true, lines: [{ v: pan, qty: 1, price: 3999 }], total: 3999 });
    expect(off.flags.map((x) => x.code)).toContain("price_changed");
    expect((await listForReview(manager)).flagged.map((x) => x.s.id)).toEqual([off.sale.id]);
    await expect(markSaleReviewed(cashier, off.sale.id, { note: "ok" })).rejects.toThrow(ForbiddenError);
    await markSaleReviewed(manager, off.sale.id, { note: "Precio de etiqueta vieja; se corrigió la etiqueta" });
    expect((await listForReview(manager)).flagged).toEqual([]);
  });
});
