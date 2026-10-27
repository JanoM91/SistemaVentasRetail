import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "@/lib/pos/local-db";
import { db } from "@/server/db";
import { cashSessions, companyModules, customers, MODULE_KEYS, paymentMethods, saleReturns, sales, stockBalances, taxProfiles, unitsOfMeasure } from "@/server/db/schema";
import { ConflictError, ValidationError } from "@/server/errors";
import { createProduct } from "@/server/modules/catalog/service";
import { computeSummary, openSession } from "@/server/modules/cash/service";
import { cancelSale, createSale, getSale } from "@/server/modules/sales/service";
import { createCustomer, setCreditTerms } from "@/server/modules/customers/service";
import { verifyStockIntegrity } from "@/server/modules/inventory/service";
import { createReturn, getReturnableSale, getStoreCredit, listReturns } from "@/server/modules/returns/service";
import { contextFor, createTenantFixture, PASSWORD, resetDatabase, type Fixture } from "../helpers";

type Ctx = Awaited<ReturnType<typeof contextFor>>;

describe("Fase 4C · devoluciones y cambios", () => {
  let f: Fixture;
  let owner: Ctx;
  let manager: Ctx;
  let cashier: Ctx;
  let coca: { id: string };
  let pan: { id: string };
  let m: Record<string, string>;
  const auth = { username: "", password: PASSWORD };

  const sell = (ctx: Ctx, lines: Array<{ v: { id: string }; qty: number; price: number; discount?: number }>, pays: Array<{ code: string; amount: number; reference?: string; received?: number }>, customerId?: string) =>
    createSale(ctx, { id: uuidv7(), cashRegisterId: f.register.id, customerId, lines: lines.map((l) => ({ variantId: l.v.id, quantity: l.qty, unitPrice: l.price, discount: l.discount ?? 0 })), payments: pays.map((p) => ({ paymentMethodId: m[p.code], amount: p.amount, reference: p.reference, received: p.received })) }, { origin: "online" });

  const ret = (ctx: Ctx, input: Record<string, unknown>) => createReturn(ctx, { id: uuidv7(), cashRegisterId: f.register.id, reasonCode: "defective", reason: "No funciona", ...input });
  const stock = async (v: { id: string }) => Number((await db.select().from(stockBalances).where(and(eq(stockBalances.variantId, v.id), eq(stockBalances.warehouseId, f.warehouse.id))))[0].onHand);
  const summary = async () => computeSummary(db, (await db.select().from(cashSessions))[0]);

  beforeEach(async () => {
    await resetDatabase();
    f = await createTenantFixture();
    for (const mod of MODULE_KEYS) await db.insert(companyModules).values({ companyId: f.company.id, module: mod, enabled: true }).onConflictDoUpdate({ target: [companyModules.companyId, companyModules.module], set: { enabled: true } });
    owner = await contextFor(f.owner);
    manager = await contextFor(f.manager);
    cashier = await contextFor(f.cashier);
    auth.username = f.manager.username;
    const [iva] = await db.select().from(taxProfiles).where(and(eq(taxProfiles.companyId, f.company.id), eq(taxProfiles.code, "IVA16")));
    const [pza] = await db.select().from(unitsOfMeasure).where(and(eq(unitsOfMeasure.companyId, f.company.id), eq(unitsOfMeasure.code, "PZA")));
    const mk = async (sku: string, price: string, cost: string) => (await createProduct(owner, { name: sku, sku, kind: "simple", unitId: pza.id, taxProfileId: iva.id, variants: [{ sku, price, cost, initialStock: 100 }] })).variants[0];
    coca = await mk("COCA", "18.50", "10");
    pan = await mk("PAN", "40.00", "25");
    m = Object.fromEntries((await db.select().from(paymentMethods).where(eq(paymentMethods.companyId, f.company.id))).map((x) => [x.code, x.id]));
    await openSession(cashier, { cashRegisterId: f.register.id, openingAmount: "500" });
  });

  it("devolución parcial con descuento: importe proporcional, inventario, efectivo autorizado y corte", async () => {
    const s = await sell(manager, [{ v: coca, qty: 3, price: 1850, discount: 100 }], [{ code: "EFECTIVO", amount: 5450 }]);
    const r = await getReturnableSale(cashier, s.sale.folio);
    const line = r.lines[0];
    expect(line.returnableQty).toBe(3);
    // El cajero no puede sacar efectivo sin autorización (política por defecto).
    await expect(ret(cashier, { saleId: s.sale.id, refundMethod: "cash", lines: [{ saleLineId: line.saleLineId, variantId: coca.id, quantity: 1 }] })).rejects.toMatchObject({ code: "return_authorization_required" });
    const r1 = await ret(cashier, { saleId: s.sale.id, refundMethod: "cash", lines: [{ saleLineId: line.saleLineId, variantId: coca.id, quantity: 1 }], authorization: auth });
    expect(r1.ret.folio).toBe("D-000001");
    expect(r1.ret.total).toBe(1817); // 54.50 / 3, redondeado
    expect(r1.ret.authorizedBy).toBe(f.manager.id);
    expect(await stock(coca)).toBe(98);
    // Lo último devuelto toma el resto exacto: 54.50 − 18.17 = 36.33. El dañado no regresa al inventario.
    await expect(ret(manager, { saleId: s.sale.id, refundMethod: "cash", lines: [{ saleLineId: line.saleLineId, variantId: coca.id, quantity: 3 }] })).rejects.toThrow(/solo se pueden devolver 2/);
    const r2 = await ret(manager, { saleId: s.sale.id, refundMethod: "cash", lines: [{ saleLineId: line.saleLineId, variantId: coca.id, quantity: 2, restock: false }] });
    expect(r2.ret.total).toBe(3633);
    expect(await stock(coca)).toBe(98);
    const sum = await summary();
    expect(sum.refunds).toMatchObject({ count: 2, cash: 5450, total: 5450 });
    expect(sum.expectedCash).toBe(50000 + 5450 - 5450);
    expect((await getReturnableSale(manager, s.sale.folio)).lines[0].returnableQty).toBe(0);
    await expect(cancelSale(manager, s.sale.id, { reason: "x prueba" })).rejects.toThrow(/devoluciones/);
    expect(await verifyStockIntegrity(db, f.company.id)).toEqual([]);
    // Reenvío idempotente.
    const again = await createReturn(manager, { id: r2.ret.id, cashRegisterId: f.register.id, saleId: s.sale.id, reasonCode: "other", reason: "otra vez", refundMethod: "cash", lines: [{ saleLineId: line.saleLineId, variantId: coca.id, quantity: 1 }] });
    expect(again.duplicate).toBe(true);
  });

  it("no hay suficiente efectivo; reembolso al mismo medio de pago con tope", async () => {
    const s = await sell(manager, [{ v: pan, qty: 20, price: 4000 }], [{ code: "TDD", amount: 60000, reference: "A1" }, { code: "EFECTIVO", amount: 20000 }]);
    const line = (await getReturnableSale(manager, s.sale.id)).lines[0];
    await expect(ret(manager, { saleId: s.sale.id, refundMethod: "cash", lines: [{ saleLineId: line.saleLineId, variantId: pan.id, quantity: 20 }] })).rejects.toThrow(/suficiente efectivo/);
    await expect(ret(manager, { saleId: s.sale.id, refundMethod: "original", refundPaymentMethodId: m.TDD, lines: [{ saleLineId: line.saleLineId, variantId: pan.id, quantity: 16 }] })).rejects.toThrow(/600.00/);
    await expect(ret(manager, { saleId: s.sale.id, refundMethod: "original", refundPaymentMethodId: m.TDC, lines: [{ saleLineId: line.saleLineId, variantId: pan.id, quantity: 1 }] })).rejects.toThrow(ValidationError);
    const r = await ret(manager, { saleId: s.sale.id, refundMethod: "original", refundPaymentMethodId: m.TDD, refundReference: "REV-9", lines: [{ saleLineId: line.saleLineId, variantId: pan.id, quantity: 15 }] });
    expect(r.ret.total).toBe(60000);
    const sum = await summary();
    expect(sum.refunds?.original).toBe(60000);
    expect(sum.expectedCash).toBe(50000 + 20000);
  });

  it("venta a crédito: la devolución abona a la cuenta y ajusta estadísticas", async () => {
    const c = await createCustomer(manager, { name: "Cliente Crédito" });
    await setCreditTerms(manager, c.id, { enabled: "on", creditLimit: "1000", creditDays: 30 });
    const s = await sell(manager, [{ v: pan, qty: 5, price: 4000 }], [{ code: "CREDITO", amount: 20000 }], c.id);
    const line = (await getReturnableSale(manager, s.sale.id)).lines[0];
    const r = await ret(cashier, { saleId: s.sale.id, refundMethod: "customer_account", lines: [{ saleLineId: line.saleLineId, variantId: pan.id, quantity: 2 }] });
    expect(r.ret.customerId).toBe(c.id);
    const [row] = await db.select().from(customers).where(eq(customers.id, c.id));
    expect(row.creditBalance).toBe(12000);
    expect(row.purchasesTotal).toBe(12000);
    const s2 = await sell(manager, [{ v: pan, qty: 1, price: 4000 }], [{ code: "EFECTIVO", amount: 4000 }]);
    const l2 = (await getReturnableSale(manager, s2.sale.id)).lines[0];
    await expect(ret(manager, { saleId: s2.sale.id, refundMethod: "customer_account", lines: [{ saleLineId: l2.saleLineId, variantId: pan.id, quantity: 1 }] })).rejects.toThrow(/no tiene cliente/);
  });

  it("cambio: vale de devolución canjeado en una venta nueva; cancelar la venta restaura el vale", async () => {
    const s = await sell(cashier, [{ v: pan, qty: 2, price: 4000 }], [{ code: "EFECTIVO", amount: 8000 }]);
    const line = (await getReturnableSale(cashier, s.sale.id)).lines[0];
    const r = await ret(cashier, { saleId: s.sale.id, reasonCode: "wrong_item", reason: "Quería otro", refundMethod: "store_credit", lines: [{ saleLineId: line.saleLineId, variantId: pan.id, quantity: 1 }] });
    expect(r.ret.storeCreditBalance).toBe(4000);
    expect((await getStoreCredit(cashier, r.ret.folio.toLowerCase())).balance).toBe(4000);
    // Nueva venta de $55.50: $40 con vale y el resto en efectivo.
    await expect(sell(cashier, [{ v: coca, qty: 3, price: 1850 }], [{ code: "VALE", amount: 5550, reference: r.ret.folio }])).rejects.toThrow(/solo tiene 40.00/);
    await expect(sell(cashier, [{ v: coca, qty: 3, price: 1850 }], [{ code: "VALE", amount: 4000 }, { code: "EFECTIVO", amount: 1550 }])).rejects.toThrow(/folio del vale/);
    const ex = await sell(cashier, [{ v: coca, qty: 3, price: 1850 }], [{ code: "VALE", amount: 4000, reference: r.ret.folio.toLowerCase() }, { code: "EFECTIVO", amount: 1550 }]);
    expect((await getStoreCredit(cashier, r.ret.folio)).balance).toBe(0);
    const sum = await summary();
    expect(sum.expectedCash).toBe(50000 + 8000 + 1550);
    expect(sum.refunds?.storeCredit).toBe(4000);
    await cancelSale(manager, ex.sale.id, { reason: "Se arrepintió" });
    expect((await getStoreCredit(cashier, r.ret.folio)).balance).toBe(4000);
    const d = await getSale(manager, s.sale.id);
    expect(d.returns.map((x) => x.folio)).toEqual([r.ret.folio]);
  });

  it("sin ticket: requiere permiso, solo vale y precio vigente; fuera de plazo requiere autorización", async () => {
    await expect(ret(cashier, { refundMethod: "cash", lines: [{ variantId: pan.id, quantity: 1 }] })).rejects.toThrow(/solo se reembolsan con vale/);
    await expect(ret(cashier, { refundMethod: "store_credit", lines: [{ variantId: pan.id, quantity: 1 }] })).rejects.toMatchObject({ code: "return_authorization_required" });
    const nt = await ret(cashier, { refundMethod: "store_credit", lines: [{ variantId: pan.id, quantity: 1 }], authorization: auth });
    expect(nt.ret.saleId).toBeNull();
    expect(nt.ret.total).toBe(4000);
    expect(await stock(pan)).toBe(101);
    // Venta de hace 40 días (política: 30).
    const s = await sell(manager, [{ v: coca, qty: 1, price: 1850 }], [{ code: "EFECTIVO", amount: 1850 }]);
    await db.update(sales).set({ soldAt: new Date(Date.now() - 40 * 86_400_000) }).where(eq(sales.id, s.sale.id));
    const r = await getReturnableSale(manager, s.sale.folio);
    expect(r.outOfPolicy).toBe(true);
    await expect(ret(manager, { saleId: s.sale.id, refundMethod: "store_credit", lines: [{ saleLineId: r.lines[0].saleLineId, variantId: coca.id, quantity: 1 }] })).rejects.toThrow(/40 días/);
    await ret(manager, { saleId: s.sale.id, refundMethod: "store_credit", lines: [{ saleLineId: r.lines[0].saleLineId, variantId: coca.id, quantity: 1 }], authorization: { username: f.owner.username, password: PASSWORD } });
    // Política sin devoluciones sin ticket.
    await db.update((await import("@/server/db/schema")).companies).set({ settings: { returns: { allowWithoutTicket: false } } }).where(eq((await import("@/server/db/schema")).companies.id, f.company.id));
    const strict = await contextFor(f.manager);
    await expect(ret(strict, { refundMethod: "store_credit", lines: [{ variantId: pan.id, quantity: 1 }] })).rejects.toThrow(ConflictError);
    expect((await listReturns(manager)).length).toBe(2);
    expect(await db.$count(saleReturns)).toBe(2);
  });
});
