import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/server/db";
import { inventoryLedger, paymentMethods, stockBalances, taxProfiles, unitsOfMeasure, warehouses } from "@/server/db/schema";
import { ConflictError, DomainError, ForbiddenError, ValidationError } from "@/server/errors";
import { createProduct, getProduct, listProducts, updateVariant } from "@/server/modules/catalog/service";
import { getKardex, listStock, registerAdjustment, reverseMovement, verifyStockIntegrity } from "@/server/modules/inventory/service";
import { InsufficientStockError } from "@/server/modules/inventory/ledger";
import { addCashMovement, closeSession, computeSummary, openSession } from "@/server/modules/cash/service";
import { cancelSale, createSale, getSale } from "@/server/modules/sales/service";
import { updateCompanySettings } from "@/server/modules/companies/service";
import { contextFor, createTenantFixture, PASSWORD, resetDatabase, type Fixture } from "../helpers";

type Ctx = Awaited<ReturnType<typeof contextFor>>;

async function refs(f: Fixture) {
  const [iva] = await db.select().from(taxProfiles).where(and(eq(taxProfiles.companyId, f.company.id), eq(taxProfiles.code, "IVA16")));
  const [pza] = await db.select().from(unitsOfMeasure).where(and(eq(unitsOfMeasure.companyId, f.company.id), eq(unitsOfMeasure.code, "PZA")));
  const [kg] = await db.select().from(unitsOfMeasure).where(and(eq(unitsOfMeasure.companyId, f.company.id), eq(unitsOfMeasure.code, "KG")));
  const [cash] = await db.select().from(paymentMethods).where(and(eq(paymentMethods.companyId, f.company.id), eq(paymentMethods.code, "EFECTIVO")));
  const [card] = await db.select().from(paymentMethods).where(and(eq(paymentMethods.companyId, f.company.id), eq(paymentMethods.code, "TDD")));
  return { iva, pza, kg, cash, card };
}

async function simpleProduct(ctx: Ctx, r: Awaited<ReturnType<typeof refs>>, o: { sku: string; price: string; cost?: string; stock?: number; barcode?: string; unitId?: string }) {
  const res = await createProduct(ctx, {
    name: `Producto ${o.sku}`,
    sku: o.sku,
    kind: "simple",
    unitId: o.unitId ?? r.pza.id,
    taxProfileId: r.iva.id,
    categoryName: "General",
    variants: [{ sku: o.sku, price: o.price, cost: o.cost ?? null, barcodes: o.barcode ? [o.barcode] : [], initialStock: o.stock ?? null }],
  });
  return res.variants[0];
}

async function onHand(warehouseId: string, variantId: string) {
  const [b] = await db.select().from(stockBalances).where(and(eq(stockBalances.warehouseId, warehouseId), eq(stockBalances.variantId, variantId)));
  return b ? Number(b.onHand) : 0;
}

describe("catálogo", () => {
  let f: Fixture;
  let r: Awaited<ReturnType<typeof refs>>;
  beforeEach(async () => {
    await resetDatabase();
    f = await createTenantFixture();
    r = await refs(f);
  });

  it("AC-20: el gerente registra producto simple con costo, código y existencia inicial", async () => {
    const manager = await contextFor(f.manager);
    const v = await simpleProduct(manager, r, { sku: "COCA600", price: "18.50", cost: "11.20", stock: 24, barcode: "7501055300075" });
    expect(v.price).toBe(1850);
    expect(v.cost).toBe(1120);
    expect(await onHand(f.warehouse.id, v.id)).toBe(24);
    const list = await listProducts(manager, { q: "7501055300075" });
    expect(list.items.map((i) => i.sku)).toEqual(["COCA600"]);
    expect(list.items[0].stock).toBe(24);
  });

  it("AC-20: producto con variantes por atributos, cada una con SKU, precio, código y existencia", async () => {
    const owner = await contextFor(f.owner);
    const { product, variants } = await createProduct(owner, {
      name: "Playera básica",
      sku: "PLAY",
      kind: "variable",
      unitId: r.pza.id,
      taxProfileId: r.iva.id,
      brandName: "Marca X",
      attributeNames: ["Talla", "Color"],
      variants: [
        { sku: "PLAY-M-NEG", attributeValues: { Talla: "M", Color: "Negro" }, price: "199", cost: "80", barcodes: ["P001"], initialStock: 5 },
        { sku: "PLAY-G-NEG", attributeValues: { Talla: "G", Color: "Negro" }, price: "219", cost: "85", barcodes: ["P002", "P002B"], initialStock: 3 },
      ],
    });
    expect(product.kind).toBe("variable");
    expect(variants.map((v) => v.variantName)).toEqual(["M / Negro", "G / Negro"]);
    const detail = await getProduct(owner, product.id);
    expect(detail.variants[1].barcodes).toEqual(["P002", "P002B"]);
    expect(detail.variants[1].stock[0].onHand).toBe(3);
  });

  it("rechaza SKU y códigos de barras repetidos, y combinaciones duplicadas", async () => {
    const owner = await contextFor(f.owner);
    await simpleProduct(owner, r, { sku: "A1", price: "10", barcode: "111" });
    await expect(simpleProduct(owner, r, { sku: "a1", price: "10" })).rejects.toThrow(ValidationError);
    await expect(simpleProduct(owner, r, { sku: "A2", price: "10", barcode: "111" })).rejects.toThrow(/111/);
    await expect(
      createProduct(owner, {
        name: "Dup", sku: "DUP", kind: "variable", unitId: r.pza.id, taxProfileId: r.iva.id, attributeNames: ["Talla"],
        variants: [
          { sku: "DUP-1", attributeValues: { Talla: "M" }, price: "1" },
          { sku: "DUP-2", attributeValues: { Talla: "m" }, price: "1" },
        ],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("permisos: el cajero no crea productos; cambiar precio exige catalog.edit_price", async () => {
    const cashier = await contextFor(f.cashier);
    await expect(simpleProduct(cashier, r, { sku: "X", price: "1" })).rejects.toThrow(ForbiddenError);
    const owner = await contextFor(f.owner);
    const v = await simpleProduct(owner, r, { sku: "B1", price: "10" });
    const updated = await updateVariant(owner, v.id, { sku: "B1", price: "12.00", barcodes: ["999"] });
    expect(updated.price).toBe(1200);
    const detail = await getProduct(cashier, (await listProducts(cashier)).items[0].id);
    expect(detail.variants[0].cost).toBeNull(); // el cajero no ve costos
  });
});

describe("inventario", () => {
  let f: Fixture;
  let r: Awaited<ReturnType<typeof refs>>;
  let owner: Ctx;
  beforeEach(async () => {
    await resetDatabase();
    f = await createTenantFixture();
    r = await refs(f);
    owner = await contextFor(f.owner);
  });

  it("costo promedio ponderado, kardex y reverso compensatorio", async () => {
    const v = await simpleProduct(owner, r, { sku: "ARROZ", price: "30", cost: "20", stock: 10 });
    await registerAdjustment(owner, { warehouseId: f.warehouse.id, variantId: v.id, movementType: "adjustment_in", quantity: 10, unitCost: "26", reason: "Compra sin orden" });
    const [bal] = await db.select().from(stockBalances).where(eq(stockBalances.variantId, v.id));
    expect(Number(bal.onHand)).toBe(20);
    expect(bal.avgCost).toBe(2300); // (10·20 + 10·26) / 20
    const out = await registerAdjustment(owner, { warehouseId: f.warehouse.id, variantId: v.id, movementType: "shrinkage", quantity: 2, reason: "Bolsa rota" });
    expect(out.unitCost).toBe(2300);
    expect(out.onHand).toBe(18);
    await reverseMovement(owner, out.ledger.id, "Se encontró la bolsa");
    expect(await onHand(f.warehouse.id, v.id)).toBe(20);
    await expect(reverseMovement(owner, out.ledger.id, "otra vez")).rejects.toThrow(/ya fue reversado/);
    const k = await getKardex(owner, v.id);
    expect(k.items.map((i) => i.movementType)).toEqual(["reversal", "shrinkage", "adjustment_in", "opening"]);
    expect(k.items.find((i) => i.movementType === "shrinkage")?.reversedBy).toBeTruthy();
    expect(await verifyStockIntegrity(db, f.company.id)).toEqual([]);
  });

  it("AC-22: el libro es inmutable a nivel base de datos", async () => {
    const v = await simpleProduct(owner, r, { sku: "INM", price: "1", stock: 1 });
    const [l] = await db.select().from(inventoryLedger).where(eq(inventoryLedger.variantId, v.id));
    await expect(pool.query("update inventory_ledger set quantity = 99 where id = $1", [l.id])).rejects.toThrow(/inmutable/);
    await expect(pool.query("delete from inventory_ledger where id = $1", [l.id])).rejects.toThrow(/inmutable/);
  });

  it("impide existencia negativa salvo que el almacén o la empresa lo permitan", async () => {
    const v = await simpleProduct(owner, r, { sku: "NEG", price: "1", stock: 1 });
    await expect(registerAdjustment(owner, { warehouseId: f.warehouse.id, variantId: v.id, movementType: "adjustment_out", quantity: 2, reason: "prueba" })).rejects.toThrow(InsufficientStockError);
    await db.update(warehouses).set({ allowsNegativeStock: true }).where(eq(warehouses.id, f.warehouse.id));
    const res = await registerAdjustment(owner, { warehouseId: f.warehouse.id, variantId: v.id, movementType: "adjustment_out", quantity: 2, reason: "prueba" });
    expect(res.onHand).toBe(-1);
    const stock = await listStock(owner, { warehouseId: f.warehouse.id, onlyAlerts: true });
    expect(stock[0].status).toBe("negative");
  });

  it("el cajero ve existencias pero no costos ni puede ajustar", async () => {
    const v = await simpleProduct(owner, r, { sku: "VIS", price: "10", cost: "5", stock: 3 });
    const cashier = await contextFor(f.cashier);
    const stock = await listStock(cashier, { warehouseId: f.warehouse.id });
    expect(stock[0].onHand).toBe(3);
    expect(stock[0].avgCost).toBeNull();
    await expect(registerAdjustment(cashier, { warehouseId: f.warehouse.id, variantId: v.id, movementType: "adjustment_in", quantity: 1, reason: "xxx" })).rejects.toThrow(ForbiddenError);
  });
});

describe("caja y ventas", () => {
  let f: Fixture;
  let r: Awaited<ReturnType<typeof refs>>;
  let owner: Ctx;
  let cashier: Ctx;
  let coca: { id: string; price: number };
  let papa: { id: string; price: number };
  let sessionId: string;

  const sale = (lines: Array<{ variantId: string; quantity: number; unitPrice: number; discount?: number }>, pay: { amount: number; received?: number; methodId?: string; reference?: string }, extra: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    cashRegisterId: f.register.id,
    lines,
    payments: [{ paymentMethodId: pay.methodId ?? r.cash.id, amount: pay.amount, received: pay.received, reference: pay.reference }],
    ...extra,
  });

  beforeEach(async () => {
    await resetDatabase();
    f = await createTenantFixture();
    r = await refs(f);
    owner = await contextFor(f.owner);
    cashier = await contextFor(f.cashier);
    coca = await simpleProduct(owner, r, { sku: "COCA", price: "18.50", cost: "11", stock: 10, barcode: "750100" });
    papa = await simpleProduct(owner, r, { sku: "PAPA", price: "35.90", cost: "20", stock: 5, unitId: r.kg.id });
    sessionId = (await openSession(cashier, { cashRegisterId: f.register.id, openingAmount: "500" })).id;
  });

  it("AC-21/22: venta en efectivo descuenta inventario, asigna folio y calcula cambio", async () => {
    const res = await createSale(cashier, sale([{ variantId: coca.id, quantity: 2, unitPrice: 1850 }, { variantId: papa.id, quantity: 0.75, unitPrice: 3590 }], { amount: 3700 + 2692, received: 10000 }), { origin: "online" });
    expect(res.status).toBe("applied");
    expect(res.sale.folio).toBe("V-000001");
    expect(res.sale.total).toBe(6392); // 0.75 kg × 35.90 = 26.925 → 26.92 (redondeo al par)
    expect(res.sale.changeAmount).toBe(10000 - 6392);
    expect(await onHand(f.warehouse.id, coca.id)).toBe(8);
    expect(await onHand(f.warehouse.id, papa.id)).toBe(4.25);
    expect(res.sale.costTotal).toBe(2 * 1100 + 1500); // 0.75 kg × 20.00
    const second = await createSale(cashier, sale([{ variantId: coca.id, quantity: 1, unitPrice: 1850 }], { amount: 1850 }), { origin: "online" });
    expect(second.sale.folio).toBe("V-000002");
    const detail = await getSale(cashier, res.sale.id);
    expect(detail.lines).toHaveLength(2);
    expect(detail.sale.costTotal).toBeNull(); // el cajero no ve utilidad
  });

  it("AC-23: reenviar la misma venta (online u offline) no la duplica ni descuenta dos veces", async () => {
    const payload = sale([{ variantId: coca.id, quantity: 3, unitPrice: 1850 }], { amount: 5550, received: 6000 });
    const a = await createSale(cashier, payload, { origin: "offline" });
    const b = await createSale(cashier, payload, { origin: "offline" });
    const c = await createSale(cashier, payload, { origin: "online" });
    expect([a.status, b.status, c.status]).toEqual(["applied", "duplicate", "duplicate"]);
    expect(b.sale.folio).toBe(a.sale.folio);
    expect(await onHand(f.warehouse.id, coca.id)).toBe(7);
  });

  it("AC-23: envíos simultáneos de la misma venta producen una sola", async () => {
    const payload = sale([{ variantId: coca.id, quantity: 1, unitPrice: 1850 }], { amount: 1850 });
    const results = await Promise.all([1, 2, 3, 4].map(() => createSale(cashier, payload, { origin: "offline" })));
    expect(results.filter((x) => x.status === "applied")).toHaveLength(1);
    expect(await onHand(f.warehouse.id, coca.id)).toBe(9);
  });

  it("en línea es estricta: precio desactualizado, existencia, pagos que no cuadran, unidades enteras", async () => {
    await expect(createSale(cashier, sale([{ variantId: coca.id, quantity: 1, unitPrice: 1500 }], { amount: 1500 }), { origin: "online" })).rejects.toMatchObject({ code: "price_changed" });
    await expect(createSale(cashier, sale([{ variantId: coca.id, quantity: 11, unitPrice: 1850 }], { amount: 20350 }), { origin: "online" })).rejects.toThrow(InsufficientStockError);
    await expect(createSale(cashier, sale([{ variantId: coca.id, quantity: 1, unitPrice: 1850 }], { amount: 1800 }), { origin: "online" })).rejects.toMatchObject({ code: "payment_mismatch" });
    await expect(createSale(cashier, sale([{ variantId: coca.id, quantity: 1.5, unitPrice: 1850 }], { amount: 2775 }), { origin: "online" })).rejects.toThrow(ValidationError);
    await expect(createSale(cashier, sale([{ variantId: coca.id, quantity: 1, unitPrice: 1850 }], { amount: 1850, methodId: r.card.id }), { origin: "online" })).rejects.toThrow(/referencia/);
    const ok = await createSale(cashier, sale([{ variantId: coca.id, quantity: 1, unitPrice: 1850 }], { amount: 1850, methodId: r.card.id, reference: "AUT123" }), { origin: "online" });
    expect(ok.status).toBe("applied");
    expect(await onHand(f.warehouse.id, coca.id)).toBe(9); // solo la venta válida descontó
  });

  it("offline acepta lo ya cobrado y marca las anomalías para revisión", async () => {
    const res = await createSale(cashier, sale([{ variantId: coca.id, quantity: 12, unitPrice: 1500 }], { amount: 18000 }, { soldAt: new Date(Date.now() - 60_000).toISOString() }), { origin: "offline" });
    expect(res.status).toBe("applied");
    expect(res.sale.origin).toBe("offline");
    expect(res.flags.map((x) => x.code).sort()).toEqual(["negative_stock", "price_changed"]);
    expect(await onHand(f.warehouse.id, coca.id)).toBe(-2);
    await expect(createSale(cashier, sale([{ variantId: coca.id, quantity: 1, unitPrice: 1850 }], { amount: 1850, methodId: r.card.id, reference: "x" }), { origin: "offline" })).rejects.toMatchObject({ code: "offline_non_cash" });
  });

  it("descuentos: el cajero necesita autorización de un gerente y hay tope por empresa", async () => {
    const disc = (auth?: { username: string; password: string }) =>
      sale([{ variantId: coca.id, quantity: 1, unitPrice: 1850, discount: 185 }], { amount: 1665 }, auth ? { discountAuthorization: auth } : {});
    await expect(createSale(cashier, disc(), { origin: "online" })).rejects.toThrow(ForbiddenError);
    await expect(createSale(cashier, disc({ username: f.cashier.username, password: PASSWORD }), { origin: "online" })).rejects.toThrow(/no tiene permiso/);
    const ok = await createSale(cashier, disc({ username: f.manager.username, password: PASSWORD }), { origin: "online" });
    expect(ok.sale.discountAuthorizedBy).toBe(f.manager.id);
    expect(ok.sale.discountTotal).toBe(185);
    await updateCompanySettings(owner, f.company.id, {
      inventory: { costingMethod: "average", allowNegativeStock: false },
      promotions: { allowStacking: false, maxDiscountPercent: 5 },
      pos: { allowSaleWithoutCustomer: true, requireCustomerForCredit: true },
      notifications: { lowStockEmail: "" },
    });
    const manager = await contextFor(f.manager);
    await expect(createSale(manager, disc(), { origin: "online" })).rejects.toThrow(/máximo permitido es 5/);
  });

  it("AC-24: cancelación con autorización regresa inventario y el corte Z cuadra", async () => {
    const s1 = await createSale(cashier, sale([{ variantId: coca.id, quantity: 2, unitPrice: 1850 }], { amount: 3700, received: 5000 }), { origin: "online" });
    const s2 = await createSale(cashier, sale([{ variantId: coca.id, quantity: 1, unitPrice: 1850 }], { amount: 1850 }), { origin: "online" });
    await expect(cancelSale(cashier, s2.sale.id, { reason: "Cliente se arrepintió" })).rejects.toThrow(ForbiddenError);
    await cancelSale(cashier, s2.sale.id, { reason: "Cliente se arrepintió", authorizerUsername: f.manager.username, authorizerPassword: PASSWORD });
    await expect(cancelSale(owner, s2.sale.id, { reason: "otra vez" })).rejects.toThrow(ConflictError);
    expect(await onHand(f.warehouse.id, coca.id)).toBe(8);

    await expect(addCashMovement(cashier, { cashSessionId: sessionId, kind: "withdrawal", amount: "100000", reason: "Depósito al banco" })).rejects.toThrow(ValidationError);
    await addCashMovement(cashier, { cashSessionId: sessionId, kind: "withdrawal", amount: "300", reason: "Depósito al banco" });
    await addCashMovement(cashier, { cashSessionId: sessionId, kind: "deposit", amount: "50", reason: "Morralla" });

    const [sess] = await db.select().from((await import("@/server/db/schema")).cashSessions).where(eq((await import("@/server/db/schema")).cashSessions.id, sessionId));
    const x = await computeSummary(db, sess);
    expect(x).toMatchObject({ salesCount: 1, salesTotal: 3700, cancelledCount: 1, cancelledTotal: 1850, cashSales: 3700, withdrawals: 30000, deposits: 5000 });
    expect(x.expectedCash).toBe(50000 + 3700 + 5000 - 30000);

    // Corte Z: 287.00 contados en denominaciones → faltan 0.00
    const z = await closeSession(cashier, { cashSessionId: sessionId, denominations: { "20000": 1, "5000": 1, "2000": 1, "1000": 1, "500": 1, "200": 1, "50": 0 }, notes: "" });
    expect(z.summary.expectedCash).toBe(28700);
    expect(z.session.countedCash).toBe(28700);
    expect(z.session.difference).toBe(0);
    await expect(createSale(cashier, sale([{ variantId: coca.id, quantity: 1, unitPrice: 1850 }], { amount: 1850 }), { origin: "online" })).rejects.toThrow(/no tiene un turno abierto/);
    await expect(cancelSale(owner, s1.sale.id, { reason: "tarde" })).rejects.toThrow(/turno cerrado/);
  });

  it("caja: un turno por caja; cerrar el turno de otro exige cash.close_any", async () => {
    await expect(openSession(owner, { cashRegisterId: f.register.id, openingAmount: "0" })).rejects.toThrow(/ya tiene un turno abierto/);
    const other = await contextFor(f.manager);
    // El gerente tiene cash.close_any; un segundo cajero no.
    const res = await closeSession(other, { cashSessionId: sessionId, countedCash: "490" });
    expect(res.session.difference).toBe(-1000);
  });

  it("aislamiento: otro tenant no puede vender en esta caja ni leer la venta", async () => {
    const s = await createSale(cashier, sale([{ variantId: coca.id, quantity: 1, unitPrice: 1850 }], { amount: 1850 }), { origin: "online" });
    const g = await createTenantFixture("intruso");
    const intruder = await contextFor(g.owner);
    await expect(getSale(intruder, s.sale.id)).rejects.toThrow(/no existe/);
    await expect(createSale(intruder, sale([{ variantId: coca.id, quantity: 1, unitPrice: 1850 }], { amount: 1850 }), { origin: "online" })).rejects.toThrow(DomainError);
    // Reusar el id de una venta ajena no revela ni duplica nada.
    await expect(createSale(intruder, { ...sale([{ variantId: coca.id, quantity: 1, unitPrice: 1850 }], { amount: 1850 }), id: s.sale.id }, { origin: "offline" })).rejects.toThrow(/no existe/);
  });
});
