import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "@/lib/pos/local-db";
import { db } from "@/server/db";
import { companyModules, MODULE_KEYS, paymentMethods, sales, taxProfiles, unitsOfMeasure } from "@/server/db/schema";
import { ForbiddenError } from "@/server/errors";
import { createProduct } from "@/server/modules/catalog/service";
import { openSession } from "@/server/modules/cash/service";
import { cancelSale, createSale } from "@/server/modules/sales/service";
import { createReturn, getReturnableSale } from "@/server/modules/returns/service";
import { categoriesFrom, getSummary, inventoryReport, productsReport, reportFilter, salesByDay, salesByHour, salesByPaymentMethod, salesBySeller } from "@/server/modules/reports/service";
import { buildReport, REPORTS, type ReportKey } from "@/server/modules/reports/tables";
import { toCsv, toPdf, toXlsx } from "@/server/modules/reports/export";
import ExcelJS from "exceljs";
import { contextFor, createTenantFixture, resetDatabase, type Fixture } from "../helpers";

type Ctx = Awaited<ReturnType<typeof contextFor>>;

describe("Fase 5A · reportes", () => {
  let f: Fixture;
  let owner: Ctx;
  let manager: Ctx;
  let cashier: Ctx;
  let m: Record<string, string>;
  let coca: { id: string };
  let pan: { id: string };

  beforeEach(async () => {
    await resetDatabase();
    f = await createTenantFixture();
    for (const mod of MODULE_KEYS) await db.insert(companyModules).values({ companyId: f.company.id, module: mod, enabled: true }).onConflictDoUpdate({ target: [companyModules.companyId, companyModules.module], set: { enabled: true } });
    owner = await contextFor(f.owner);
    manager = await contextFor(f.manager);
    cashier = await contextFor(f.cashier);
    const [iva] = await db.select().from(taxProfiles).where(and(eq(taxProfiles.companyId, f.company.id), eq(taxProfiles.code, "IVA16")));
    const [pza] = await db.select().from(unitsOfMeasure).where(and(eq(unitsOfMeasure.companyId, f.company.id), eq(unitsOfMeasure.code, "PZA")));
    coca = (await createProduct(owner, { name: "Coca", sku: "COCA", kind: "simple", categoryName: "Bebidas", unitId: pza.id, taxProfileId: iva.id, variants: [{ sku: "COCA", price: "11.60", cost: "6.00", initialStock: 50 }] })).variants[0];
    pan = (await createProduct(owner, { name: "Pan", sku: "PAN", kind: "simple", categoryName: "Panadería", unitId: pza.id, taxProfileId: iva.id, variants: [{ sku: "PAN", price: "23.20", cost: null, initialStock: 20 }] })).variants[0];
    m = Object.fromEntries((await db.select().from(paymentMethods).where(eq(paymentMethods.companyId, f.company.id))).map((x) => [x.code, x.id]));
    await openSession(cashier, { cashRegisterId: f.register.id, openingAmount: "500" });
  });

  const sell = (lines: Array<{ v: { id: string }; qty: number; price: number }>, pay: Array<{ code: string; amount: number; reference?: string }>) =>
    createSale(cashier, { id: uuidv7(), cashRegisterId: f.register.id, lines: lines.map((l) => ({ variantId: l.v.id, quantity: l.qty, unitPrice: l.price, discount: 0 })), payments: pay.map((p) => ({ paymentMethodId: m[p.code], amount: p.amount, reference: p.reference })) }, { origin: "online" });

  it("resumen: venta neta, devoluciones, cancelaciones y utilidad incompleta por producto sin costo", async () => {
    const s1 = await sell([{ v: coca, qty: 4, price: 1160 }], [{ code: "EFECTIVO", amount: 4640 }]); // neto 40.00, costo 24.00
    await sell([{ v: pan, qty: 1, price: 2320 }], [{ code: "TDD", amount: 2320, reference: "X1" }]); // neto 20.00, sin costo
    const s3 = await sell([{ v: coca, qty: 1, price: 1160 }], [{ code: "EFECTIVO", amount: 1160 }]);
    await cancelSale(manager, s3.sale.id, { reason: "Error de captura" });
    const line = (await getReturnableSale(manager, s1.sale.id)).lines[0];
    await createReturn(manager, { id: uuidv7(), cashRegisterId: f.register.id, saleId: s1.sale.id, reasonCode: "defective", reason: "Abierto", refundMethod: "store_credit", lines: [{ saleLineId: line.saleLineId, variantId: coca.id, quantity: 1 }] });

    const fl = reportFilter(manager, { periodo: "hoy" });
    const { current: c, previous: p } = await getSummary(fl);
    expect(c).toMatchObject({ tickets: 2, gross: 6960, net: 6000, tax: 960, returnsCount: 1, returnsTotal: 1160, netSales: 5800, cancelledCount: 1, cancelledTotal: 1160 });
    // Utilidad: Coca (40 − 24) − devolución (10 − 6) = 12.00; el pan (20.00) no tiene costo.
    expect(c.profit).toBe(1200);
    expect(c.uncostedSales).toBe(2000);
    expect(c.profitComplete).toBe(false);
    expect(c.margin).toBe(40); // 12 / (50 − 20)
    expect(p.tickets).toBe(0);

    const days = await salesByDay(fl);
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ tickets: 2, total: 6960, returns: 1160, netSales: 5800 });
    const { byHour } = await salesByHour(fl);
    expect(byHour.reduce((a, h) => a + h.tickets, 0)).toBe(2);
    const pm = await salesByPaymentMethod(fl);
    expect(pm.map((x) => [x.kind, x.amount, x.share])).toEqual([["cash", 4640, 66.7], ["card_debit", 2320, 33.3]]);
    expect((await salesBySeller(fl))[0]).toMatchObject({ name: "cashier", tickets: 2 });

    const prods = await productsReport(fl);
    const cocaRow = prods.find((x) => x.sku === "COCA")!;
    expect(cocaRow).toMatchObject({ qty: 4, returnedQty: 1, total: 3480, net: 3000, profit: 1200, margin: 40, uncosted: false });
    expect(prods.find((x) => x.sku === "PAN")).toMatchObject({ profit: null, uncosted: true });
    const cats = categoriesFrom(prods, true);
    expect(cats.find((x) => x.category === "Panadería")).toMatchObject({ profit: null, uncosted: true });

    const inv = await inventoryReport(fl);
    expect(inv.find((x) => x.sku === "COCA")).toMatchObject({ onHand: 47, avgCost: 600, value: 28200, sold30: 4 });
    expect(inv.find((x) => x.sku === "PAN")).toMatchObject({ onHand: 19, value: 0, uncosted: true });
  });

  it("periodo y zona horaria: una venta de ayer en la noche no cae en hoy; permisos", async () => {
    const s = await sell([{ v: coca, qty: 1, price: 1160 }], [{ code: "EFECTIVO", amount: 1160 }]);
    // 23:30 de ayer, hora de la empresa.
    const yesterday = new Date(Date.now() - 86_400_000);
    const local = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(yesterday);
    const { startOfLocalDay } = await import("@/lib/period");
    const late = new Date(startOfLocalDay(local, "America/Mexico_City").getTime() + (23 * 60 + 30) * 60_000);
    await db.update(sales).set({ soldAt: late }).where(eq(sales.id, s.sale.id));
    expect((await getSummary(reportFilter(manager, { periodo: "hoy" }))).current.tickets).toBe(0);
    const ayer = await getSummary(reportFilter(manager, { periodo: "ayer" }));
    expect(ayer.current.tickets).toBe(1);
    expect((await getSummary(reportFilter(manager, { periodo: "hoy" }))).previous.tickets).toBe(1);
    expect(() => reportFilter(cashier, { periodo: "hoy" })).toThrow(ForbiddenError);
    // Sin permiso de utilidades, no se exponen costos ni utilidad.
    const noProfit = await contextFor(f.manager);
    noProfit.permissions.delete("reports.view_profit");
    const fl = reportFilter(noProfit, { periodo: "ayer" });
    expect((await getSummary(fl)).current.profit).toBe(0);
    expect((await productsReport(fl))[0].profit).toBeNull();
    expect((await inventoryReport(fl))[0].value).toBeNull();
  });

  it("exporta los 7 reportes a CSV, Excel y PDF", async () => {
    await sell([{ v: coca, qty: 2, price: 1160 }], [{ code: "EFECTIVO", amount: 2320 }]);
    await sell([{ v: pan, qty: 1, price: 2320 }], [{ code: "EFECTIVO", amount: 2320 }]);
    const fl = reportFilter(manager, { periodo: "hoy" });
    for (const key of Object.keys(REPORTS) as ReportKey[]) {
      const doc = await buildReport(manager, fl, key);
      expect(doc.tables.length).toBeGreaterThan(0);
      const csv = toCsv(doc);
      expect(csv.startsWith("\uFEFF")).toBe(true);
      const pdf = await toPdf(doc);
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
      const xlsx = await toXlsx(doc);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
      expect(wb.worksheets.length).toBe(doc.tables.length);
    }
    const prod = await buildReport(manager, fl, "productos");
    const csv = toCsv(prod);
    expect(csv).toContain("COCA,Coca,Bebidas,2,0,23.20,8.00");
    expect(csv).toContain("Utilidad incompleta");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await toXlsx(prod)) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Por producto")!;
    expect(ws.getRow(5).getCell(6).value).toBe(23.2);
  });
});
