import "server-only";
import type { ServiceContext } from "@/server/service-context";
import { requireCompany } from "@/server/service-context";
import type { ReportDocument, ReportTable } from "./export";
import { cashReport, categoriesFrom, customersReport, getSummary, inventoryReport, productsReport, promotionsReport, salesByBranch, salesByDay, salesByHour, salesByPaymentMethod, salesBySeller, type ReportFilter } from "./service";

export const REPORTS = {
  resumen: "Resumen",
  ventas: "Ventas",
  productos: "Productos y utilidad",
  inventario: "Inventario",
  clientes: "Clientes",
  promociones: "Promociones",
  caja: "Cortes de caja",
} as const;
export type ReportKey = keyof typeof REPORTS;

const DOW = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const sum = <T,>(rows: T[], k: keyof T) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
const profitNote = "Utilidad incompleta: hay productos vendidos sin costo registrado. Captura su costo en Catálogo o con una compra para que la utilidad sea confiable.";

export async function buildReport(ctx: ServiceContext, f: ReportFilter, key: ReportKey): Promise<ReportDocument> {
  const company = requireCompany(ctx);
  const tables: ReportTable[] = [];
  const P = f.showProfit;
  switch (key) {
    case "resumen": {
      const { current: c, previous: p } = await getSummary(f);
      const rows = [
        { k: "Venta total (con impuestos)", a: c.gross, b: p.gross },
        { k: "Devoluciones", a: c.returnsTotal, b: p.returnsTotal },
        { k: "Venta neta", a: c.netSales, b: p.netSales },
        { k: "Venta neta sin IVA", a: c.netRevenue, b: p.netRevenue },
        { k: "Tickets", a: c.tickets, b: p.tickets, int: true },
        { k: "Ticket promedio", a: c.avgTicket, b: p.avgTicket },
        { k: "Descuentos y promociones", a: c.discount, b: p.discount },
        { k: "Ventas canceladas", a: c.cancelledTotal, b: p.cancelledTotal },
        ...(P ? [{ k: "Utilidad bruta", a: c.profit, b: p.profit }, { k: "Venta sin costo registrado", a: c.uncostedSales, b: p.uncostedSales }] : []),
      ];
      tables.push({
        title: "Indicadores",
        columns: [{ key: "k", label: "Indicador", type: "text" }, { key: "a", label: f.period.label, type: "text" }, { key: "b", label: `Anterior (${f.period.previous.label})`, type: "text" }],
        rows: rows.map((r) => ({ k: r.k, a: r.int ? String(r.a) : `$${(r.a / 100).toFixed(2)}`, b: r.int ? String(r.b) : `$${(r.b / 100).toFixed(2)}` })),
        note: P && !c.profitComplete ? profitNote : undefined,
      });
      const days = await salesByDay(f);
      tables.push({ title: "Venta por día", columns: [{ key: "day", label: "Día", type: "text" }, { key: "tickets", label: "Tickets", type: "int" }, { key: "total", label: "Venta", type: "money" }, { key: "returns", label: "Devoluciones", type: "money" }, { key: "netSales", label: "Venta neta", type: "money" }], rows: days, totals: { tickets: sum(days, "tickets"), total: sum(days, "total"), returns: sum(days, "returns"), netSales: sum(days, "netSales") } });
      break;
    }
    case "ventas": {
      const [byBranch, byMethod, bySeller, hours] = await Promise.all([salesByBranch(f), salesByPaymentMethod(f), salesBySeller(f), salesByHour(f)]);
      tables.push({
        title: "Por sucursal",
        columns: [{ key: "name", label: "Sucursal", type: "text" }, { key: "tickets", label: "Tickets", type: "int" }, { key: "total", label: "Venta", type: "money" }, { key: "returns", label: "Devoluciones", type: "money" }, { key: "netSales", label: "Venta neta", type: "money" }, { key: "avgTicket", label: "Ticket prom.", type: "money" }, ...(P ? [{ key: "profit", label: "Utilidad", type: "money" as const }] : [])],
        rows: byBranch,
        totals: { tickets: sum(byBranch, "tickets"), total: sum(byBranch, "total"), returns: sum(byBranch, "returns"), netSales: sum(byBranch, "netSales"), ...(P ? { profit: sum(byBranch, "profit") } : {}) },
        note: P && byBranch.some((b) => b.uncosted > 0) ? profitNote : undefined,
      });
      tables.push({ title: "Por forma de pago", columns: [{ key: "name", label: "Método", type: "text" }, { key: "count", label: "Pagos", type: "int" }, { key: "amount", label: "Importe", type: "money" }, { key: "share", label: "Participación", type: "percent" }], rows: byMethod, totals: { count: sum(byMethod, "count"), amount: sum(byMethod, "amount") } });
      tables.push({ title: "Por vendedor", columns: [{ key: "name", label: "Vendedor", type: "text" }, { key: "tickets", label: "Tickets", type: "int" }, { key: "total", label: "Venta", type: "money" }, { key: "avgTicket", label: "Ticket prom.", type: "money" }, { key: "discount", label: "Descuentos", type: "money" }, { key: "withCustomer", label: "Con cliente", type: "int" }], rows: bySeller, totals: { tickets: sum(bySeller, "tickets"), total: sum(bySeller, "total"), discount: sum(bySeller, "discount"), withCustomer: sum(bySeller, "withCustomer") } });
      tables.push({ title: "Por hora", columns: [{ key: "label", label: "Hora", type: "text" }, { key: "tickets", label: "Tickets", type: "int" }, { key: "total", label: "Venta", type: "money" }], rows: hours.byHour.filter((h) => h.tickets).map((h) => ({ label: `${String(h.hour).padStart(2, "0")}:00`, ...h })) });
      tables.push({ title: "Por día de la semana", columns: [{ key: "label", label: "Día", type: "text" }, { key: "tickets", label: "Tickets", type: "int" }, { key: "total", label: "Venta", type: "money" }], rows: hours.byDow.map((d) => ({ label: DOW[d.dow], ...d })) });
      break;
    }
    case "productos": {
      const prods = await productsReport(f, { limit: 2000 });
      const cats = categoriesFrom(prods, P);
      tables.push({
        title: "Por categoría",
        columns: [{ key: "category", label: "Categoría", type: "text" }, { key: "qty", label: "Piezas netas", type: "qty" }, { key: "total", label: "Venta", type: "money" }, { key: "share", label: "% venta", type: "percent" }, ...(P ? [{ key: "profit", label: "Utilidad", type: "money" as const }, { key: "margin", label: "Margen", type: "percent" as const }] : [])],
        rows: cats,
        totals: { total: sum(cats, "total"), ...(P ? { profit: sum(cats, "profit") } : {}) },
        note: P && cats.some((c) => c.uncosted) ? profitNote : undefined,
      });
      tables.push({
        title: "Por producto",
        columns: [{ key: "sku", label: "SKU", type: "text" }, { key: "name", label: "Producto", type: "text" }, { key: "category", label: "Categoría", type: "text" }, { key: "qty", label: "Vendido", type: "qty" }, { key: "returnedQty", label: "Devuelto", type: "qty" }, { key: "total", label: "Venta neta", type: "money" }, ...(P ? [{ key: "profit", label: "Utilidad", type: "money" as const }, { key: "margin", label: "Margen", type: "percent" as const }] : [])],
        rows: prods,
        totals: { qty: sum(prods, "qty"), returnedQty: sum(prods, "returnedQty"), total: sum(prods, "total"), ...(P ? { profit: sum(prods, "profit") } : {}) },
        note: P && prods.some((x) => x.uncosted) ? profitNote : undefined,
      });
      break;
    }
    case "inventario": {
      const inv = await inventoryReport(f);
      tables.push({
        title: "Existencias y cobertura",
        columns: [{ key: "sku", label: "SKU", type: "text" }, { key: "name", label: "Producto", type: "text" }, { key: "category", label: "Categoría", type: "text" }, { key: "onHand", label: "Existencia", type: "qty" }, ...(P ? [{ key: "avgCost", label: "Costo prom.", type: "money" as const }, { key: "value", label: "Valor", type: "money" as const }] : []), { key: "sold30", label: "Venta 30 d", type: "qty" }, { key: "coverageDays", label: "Días de cobertura", type: "int" }, { key: "lastSale", label: "Última venta", type: "date" }],
        rows: inv,
        totals: P ? { value: sum(inv, "value") } : undefined,
        note: P && inv.some((x) => x.uncosted) ? "Hay existencias sin costo: el valor del inventario está incompleto." : undefined,
      });
      break;
    }
    case "clientes": {
      const c = await customersReport(f);
      tables.push({ title: "Mezcla de clientes", columns: [{ key: "k", label: "Concepto", type: "text" }, { key: "v", label: "Valor", type: "text" }], rows: [{ k: "Clientes nuevos", v: String(c.newCustomers) }, { k: "Clientes que regresaron", v: String(c.returning) }, { k: "Tickets sin cliente", v: String(c.anonymousTickets) }, { k: "Venta con cliente identificado", v: `$${(c.identifiedTotal / 100).toFixed(2)}` }, { k: "Venta sin cliente", v: `$${(c.anonymousTotal / 100).toFixed(2)}` }] });
      tables.push({ title: "Mejores clientes", columns: [{ key: "code", label: "Clave", type: "text" }, { key: "name", label: "Cliente", type: "text" }, { key: "tickets", label: "Compras", type: "int" }, { key: "total", label: "Venta", type: "money" }, { key: "avgTicket", label: "Ticket prom.", type: "money" }, { key: "lastPurchase", label: "Última compra", type: "date" }], rows: c.top });
      break;
    }
    case "promociones": {
      const r = await promotionsReport(f);
      tables.push({ title: "Promociones aplicadas", columns: [{ key: "name", label: "Promoción", type: "text" }, { key: "uses", label: "Usos", type: "int" }, { key: "discount", label: "Descuento", type: "money" }, { key: "sales", label: "Venta de esos tickets", type: "money" }, { key: "coupons", label: "Cupones distintos", type: "int" }], rows: r.promotions, totals: { uses: sum(r.promotions, "uses"), discount: sum(r.promotions, "discount"), sales: sum(r.promotions, "sales") } });
      tables.push({ title: "Descuentos", columns: [{ key: "k", label: "Origen", type: "text" }, { key: "v", label: "Importe", type: "money" }], rows: [{ k: "Promociones", v: r.promoDiscount }, { k: "Manuales (autorizados en caja)", v: r.manualDiscount }] });
      break;
    }
    case "caja": {
      const r = await cashReport(f);
      tables.push({
        title: "Cortes Z",
        columns: [{ key: "closedAt", label: "Cierre", type: "date" }, { key: "branch", label: "Sucursal", type: "text" }, { key: "register", label: "Caja", type: "text" }, { key: "openedBy", label: "Abrió", type: "text" }, { key: "salesCount", label: "Ventas", type: "int" }, { key: "salesTotal", label: "Venta", type: "money" }, { key: "expected", label: "Esperado", type: "money" }, { key: "counted", label: "Contado", type: "money" }, { key: "difference", label: "Diferencia", type: "money" }],
        rows: r.sessions,
        totals: { salesCount: sum(r.sessions, "salesCount"), salesTotal: sum(r.sessions, "salesTotal"), difference: sum(r.sessions, "difference") },
        note: r.short || r.over ? `Faltantes ${(r.short / 100).toFixed(2)} · sobrantes ${(r.over / 100).toFixed(2)}` : undefined,
      });
      break;
    }
  }
  return { title: `${REPORTS[key]} · ${company.tradeName}`, subtitle: `${f.period.label} · ${f.branchLabel}`, company: company.tradeName, currency: f.currency, generatedAt: new Date(), tz: f.tz, tables };
}
