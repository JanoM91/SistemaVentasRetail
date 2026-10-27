import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { branches, companyModules, payables, paymentMethods, purchaseOrders, stockBalances, taxProfiles, unitsOfMeasure, userBranches, warehouses } from "@/server/db/schema";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { createProduct } from "@/server/modules/catalog/service";
import { registerAdjustment, verifyStockIntegrity } from "@/server/modules/inventory/service";
import { applyCount, cancelTransfer, createCount, createTransfer, getCount, receiveTransfer, recordCount } from "@/server/modules/inventory/operations";
import {
  cancelPurchaseOrder,
  createOrdersFromSuggestions,
  createPurchaseOrder,
  createSupplier,
  createSupplierReturn,
  getPurchaseOrder,
  getPurchaseSuggestions,
  listPayables,
  payPayable,
  receivePurchase,
  sendPurchaseOrder,
  updatePurchaseOrder,
} from "@/server/modules/purchasing/service";
import { openSession } from "@/server/modules/cash/service";
import { createSale } from "@/server/modules/sales/service";
import { MODULE_KEYS } from "@/server/db/schema";
import { contextFor, createTenantFixture, resetDatabase, type Fixture } from "../helpers";

type Ctx = Awaited<ReturnType<typeof contextFor>>;

async function enableAllModules(f: Fixture) {
  for (const m of MODULE_KEYS) {
    await db.insert(companyModules).values({ companyId: f.company.id, module: m, enabled: true }).onConflictDoUpdate({ target: [companyModules.companyId, companyModules.module], set: { enabled: true } });
  }
}

async function stock(warehouseId: string, variantId: string) {
  const [b] = await db.select().from(stockBalances).where(and(eq(stockBalances.warehouseId, warehouseId), eq(stockBalances.variantId, variantId)));
  return b ? { onHand: Number(b.onHand), avg: b.avgCost } : { onHand: 0, avg: null };
}

describe("Fase 4A · compras, traspasos y conteos", () => {
  let f: Fixture;
  let owner: Ctx;
  let manager: Ctx;
  let cashier: Ctx;
  let coca: { id: string };
  let arroz: { id: string };
  let supplierId: string;

  beforeEach(async () => {
    await resetDatabase();
    f = await createTenantFixture();
    await enableAllModules(f);
    owner = await contextFor(f.owner);
    manager = await contextFor(f.manager);
    cashier = await contextFor(f.cashier);
    const [iva] = await db.select().from(taxProfiles).where(and(eq(taxProfiles.companyId, f.company.id), eq(taxProfiles.code, "IVA16")));
    const [pza] = await db.select().from(unitsOfMeasure).where(and(eq(unitsOfMeasure.companyId, f.company.id), eq(unitsOfMeasure.code, "PZA")));
    const mk = async (sku: string, price: string, cost: string, stockQty: number, reorder?: string) =>
      (await createProduct(owner, { name: sku, sku, kind: "simple", unitId: pza.id, taxProfileId: iva.id, variants: [{ sku, price, cost, initialStock: stockQty, reorderPoint: reorder ?? null }] })).variants[0];
    coca = await mk("COCA", "18.50", "10.00", 10, "8");
    arroz = await mk("ARROZ", "30.00", "20.00", 5);
    supplierId = (await createSupplier(manager, { code: "dist1", name: "Distribuidora Uno", paymentTermsDays: 15, leadTimeDays: 3 })).id;
  });

  it("orden de compra: borrador editable, envío con autorización, permisos", async () => {
    await expect(createPurchaseOrder(cashier, { supplierId, warehouseId: f.warehouse.id, lines: [{ variantId: coca.id, quantity: 1, unitCost: "10" }] })).rejects.toThrow(ForbiddenError);
    const po = await createPurchaseOrder(manager, { supplierId, warehouseId: f.warehouse.id, lines: [{ variantId: coca.id, quantity: 10, unitCost: "10.00" }, { variantId: arroz.id, quantity: 4, unitCost: "21.50" }] });
    expect(po.folio).toBe("OC-000001");
    expect(po.subtotal).toBe(10000 + 8600);
    expect(po.taxTotal).toBe(1600 + 1376);
    const upd = await updatePurchaseOrder(manager, po.id, { supplierId, warehouseId: f.warehouse.id, lines: [{ variantId: coca.id, quantity: 12, unitCost: "10.00" }] });
    expect(upd.subtotal).toBe(12000);
    await expect(receivePurchase(manager, { purchaseOrderId: po.id, lines: [{ variantId: coca.id, quantity: 1, unitCost: "10" }] })).rejects.toThrow(/Envía/);
    await sendPurchaseOrder(manager, po.id);
    await expect(updatePurchaseOrder(manager, po.id, { supplierId, warehouseId: f.warehouse.id, lines: [{ variantId: coca.id, quantity: 1, unitCost: "1" }] })).rejects.toThrow(ConflictError);
  });

  it("recepción parcial con flete prorrateado: costo, inventario, orden y cuenta por pagar", async () => {
    const po = await createPurchaseOrder(manager, { supplierId, warehouseId: f.warehouse.id, lines: [{ variantId: coca.id, quantity: 10, unitCost: "10.00" }] });
    await sendPurchaseOrder(manager, po.id);
    const r1 = await receivePurchase(manager, {
      purchaseOrderId: po.id,
      supplierInvoice: "A-123",
      invoiceDate: "2026-10-01",
      extraCosts: [{ concept: "Flete", amount: "30.00" }],
      lines: [{ variantId: coca.id, quantity: 6, unitCost: "10.00" }],
    });
    expect(r1.folio).toBe("RC-000001");
    expect(r1.total).toBe(6000 + 960 + 3000);
    const s = await stock(f.warehouse.id, coca.id);
    expect(s.onHand).toBe(16);
    expect(s.avg).toBe(1188); // (10·1000 + 6·1500) / 16 = 1187.5 → 1188
    expect((await getPurchaseOrder(manager, po.id)).po.status).toBe("partial");
    const [pay] = await db.select().from(payables).where(eq(payables.receiptId, r1.id));
    expect(pay.dueDate).toBe("2026-10-16");
    await expect(receivePurchase(manager, { purchaseOrderId: po.id, lines: [{ variantId: coca.id, quantity: 5, unitCost: "10" }] })).rejects.toThrow(/solo faltan 4/);
    await receivePurchase(manager, { purchaseOrderId: po.id, lines: [{ variantId: coca.id, quantity: 4, unitCost: "10.50" }] });
    expect((await getPurchaseOrder(manager, po.id)).po.status).toBe("received");
    expect((await stock(f.warehouse.id, coca.id)).onHand).toBe(20);
    expect(await verifyStockIntegrity(db, f.company.id)).toEqual([]);
  });

  it("compra directa, devolución a proveedor con nota de crédito y pagos", async () => {
    const r = await receivePurchase(manager, { supplierId, warehouseId: f.warehouse.id, supplierInvoice: "B-9", lines: [{ variantId: arroz.id, quantity: 10, unitCost: "20.00" }] });
    expect(r.purchaseOrderId).toBeNull();
    expect(r.total).toBe(20000 + 3200);
    const ret = await createSupplierReturn(manager, { supplierId, warehouseId: f.warehouse.id, receiptId: r.id, reason: "Bultos rotos", lines: [{ variantId: arroz.id, quantity: 2 }] });
    expect(ret.creditAmount).toBe(4640); // 2 × 20.00 + IVA
    expect((await stock(f.warehouse.id, arroz.id)).onHand).toBe(13);
    const [p] = await db.select().from(payables).where(eq(payables.receiptId, r.id));
    expect(p.balance).toBe(23200 - 4640);
    await expect(payPayable(cashier, { payableId: p.id, amount: "10", method: "Transferencia" })).rejects.toThrow(ForbiddenError);
    await expect(payPayable(manager, { payableId: p.id, amount: "999", method: "Transferencia" })).rejects.toThrow(/excede el saldo/);
    await payPayable(manager, { payableId: p.id, amount: "100.00", method: "Transferencia", reference: "SPEI 1" });
    const res = await payPayable(manager, { payableId: p.id, amount: "85.60", method: "Efectivo" });
    expect(res.balance).toBe(0);
    expect((await listPayables(manager, { status: "paid" })).map((x) => x.p.id)).toContain(p.id);
  });

  it("cancelar orden sin recepciones; cerrar orden parcial", async () => {
    const a = await createPurchaseOrder(manager, { supplierId, warehouseId: f.warehouse.id, lines: [{ variantId: coca.id, quantity: 3, unitCost: "10" }] });
    expect(await cancelPurchaseOrder(manager, a.id, "Ya no se necesita")).toBe("cancelled");
    const b = await createPurchaseOrder(manager, { supplierId, warehouseId: f.warehouse.id, lines: [{ variantId: coca.id, quantity: 3, unitCost: "10" }] });
    await sendPurchaseOrder(manager, b.id);
    await receivePurchase(manager, { purchaseOrderId: b.id, lines: [{ variantId: coca.id, quantity: 1, unitCost: "10" }] });
    expect(await cancelPurchaseOrder(manager, b.id, "El proveedor no surtió el resto")).toBe("received");
    const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, b.id));
    expect(po.cancelReason).toMatch(/no surtió/);
  });

  it("sugerencias de compra con ventas, existencia y punto de reorden; órdenes por proveedor", async () => {
    // El proveedor queda como principal del producto al recibirle una compra.
    await receivePurchase(manager, { supplierId, warehouseId: f.warehouse.id, lines: [{ variantId: coca.id, quantity: 1, unitCost: "10" }] });
    // Vender 6 cocas en el mes: venta diaria 0.2; existencia 11 − 6 = 5 ≤ punto de reorden 8.
    await openSession(cashier, { cashRegisterId: f.register.id, openingAmount: "0" });
    const [cash] = await db.select().from(paymentMethods).where(and(eq(paymentMethods.companyId, f.company.id), eq(paymentMethods.code, "EFECTIVO")));
    await createSale(cashier, { id: randomUUID(), cashRegisterId: f.register.id, lines: [{ variantId: coca.id, quantity: 6, unitPrice: 1850 }], payments: [{ paymentMethodId: cash.id, amount: 11100 }] }, { origin: "online" });
    const sug = await getPurchaseSuggestions(manager, f.warehouse.id);
    const c = sug.find((x) => x.variantId === coca.id)!;
    expect(c).toMatchObject({ onHand: 5, sold30: 6, reorderPoint: 8, supplierId });
    expect(c.suggested).toBe(4); // objetivo max(0, 0.2×17=3.4, 9) = 9 → 9 − 5
    expect(sug.find((x) => x.variantId === arroz.id)).toBeUndefined(); // sin ventas ni punto de reorden
    const orders = await createOrdersFromSuggestions(manager, f.warehouse.id, [{ variantId: coca.id, quantity: c.suggested, supplierId, unitCost: c.lastCost! }]);
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe("draft");
    expect((await getPurchaseSuggestions(manager, f.warehouse.id)).find((x) => x.variantId === coca.id)).toBeDefined(); // borrador no cuenta como pedido
    await sendPurchaseOrder(manager, orders[0].id);
    expect((await getPurchaseSuggestions(manager, f.warehouse.id)).find((x) => x.variantId === coca.id)).toBeUndefined(); // ya pedido
  });

  it("traspaso: tránsito, recepción con faltante, cancelación y permisos de destino", async () => {
    const [norte] = await db.insert(branches).values({ tenantId: f.tenant.id, companyId: f.company.id, code: "NORTE", name: "Norte" }).returning();
    const [whN] = await db.insert(warehouses).values({ tenantId: f.tenant.id, companyId: f.company.id, branchId: norte.id, code: "N-ALM", name: "Almacén Norte", isDefault: true }).returning();
    const t = await createTransfer(manager, { fromWarehouseId: f.warehouse.id, toWarehouseId: whN.id, lines: [{ variantId: coca.id, quantity: 5 }] });
    expect(t.folio).toBe("TR-000001");
    expect((await stock(f.warehouse.id, coca.id)).onHand).toBe(5);
    expect((await stock(whN.id, coca.id)).onHand).toBe(0);
    // El gerente está restringido a Centro: no puede recibir en Norte.
    const lines = (await import("@/server/modules/inventory/operations")).getTransfer;
    const detail = await lines(owner, t.id);
    await expect(receiveTransfer(manager, t.id, { lines: [{ lineId: detail.lines[0].l.id, quantityReceived: 4 }] })).rejects.toThrow(ForbiddenError);
    const res = await receiveTransfer(owner, t.id, { lines: [{ lineId: detail.lines[0].l.id, quantityReceived: 4 }], notes: "Llegó una lata abollada y se tiró" });
    expect(res.differences).toEqual([{ variantId: coca.id, sent: 5, received: 4 }]);
    const n = await stock(whN.id, coca.id);
    expect(n.onHand).toBe(4);
    expect(n.avg).toBe(1000); // entra al costo con que salió
    await expect(receiveTransfer(owner, t.id, { lines: [{ lineId: detail.lines[0].l.id, quantityReceived: 1 }] })).rejects.toThrow(ConflictError);

    const t2 = await createTransfer(manager, { fromWarehouseId: f.warehouse.id, toWarehouseId: whN.id, lines: [{ variantId: arroz.id, quantity: 2 }] });
    expect((await stock(f.warehouse.id, arroz.id)).onHand).toBe(3);
    await cancelTransfer(manager, t2.id, "Se equivocó de sucursal");
    expect((await stock(f.warehouse.id, arroz.id)).onHand).toBe(5);
    await expect(createTransfer(manager, { fromWarehouseId: f.warehouse.id, toWarehouseId: f.warehouse.id, lines: [{ variantId: coca.id, quantity: 1 }] })).rejects.toThrow(ValidationError);
    expect(await verifyStockIntegrity(db, f.company.id)).toEqual([]);
    // userBranches se usa para el gerente restringido; confirmamos la restricción.
    expect((await db.select().from(userBranches).where(eq(userBranches.userId, f.manager.id))).map((x) => x.branchId)).toEqual([f.branch.id]);
  });

  it("conteo físico: la existencia al capturar evita diferencias falsas por ventas durante el conteo", async () => {
    const c = await createCount(manager, { warehouseId: f.warehouse.id });
    expect(c.folio).toBe("CF-000001");
    await expect(createCount(manager, { warehouseId: f.warehouse.id })).rejects.toThrow(/Ya hay un conteo abierto/);
    // Después de iniciar el conteo se vende/sale 1 coca (10 → 9); al contar hay 8 físicamente (falta 1 real).
    await registerAdjustment(owner, { warehouseId: f.warehouse.id, variantId: coca.id, movementType: "adjustment_out", quantity: 1, reason: "Venta de mostrador" });
    await recordCount(cashier.permissions.has("inventory.count") ? cashier : manager, c.id, { entries: [{ variantId: coca.id, countedQty: 8 }, { variantId: arroz.id, countedQty: 5 }] });
    const view = await getCount(manager, c.id);
    const lc = view.lines.find((l) => l.variantId === coca.id)!;
    expect(lc).toMatchObject({ systemQty: 9, countedQty: 8, difference: -1 });
    expect(view.lines.find((l) => l.variantId === arroz.id)!.difference).toBe(0);
    await expect(applyCount(cashier, c.id)).rejects.toThrow(ForbiddenError);
    const res = await applyCount(manager, c.id, "Conteo de fin de mes");
    expect(res).toMatchObject({ counted: 2, adjusted: 1, valueDifference: -1000 });
    expect((await stock(f.warehouse.id, coca.id)).onHand).toBe(8);
    await expect(applyCount(manager, c.id)).rejects.toThrow(ConflictError);
    expect(await verifyStockIntegrity(db, f.company.id)).toEqual([]);
  });
});
