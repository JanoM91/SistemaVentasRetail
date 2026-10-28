import { sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db";
import { hasPermission, requirePermission } from "@/server/authz/guard";
import { requireCompany, type ServiceContext } from "@/server/service-context";
import { resolvePeriod, type Period } from "@/lib/period";

/**
 * Reportes. Reglas comunes:
 * - Solo ventas completadas; las canceladas se informan aparte.
 * - «Venta neta» = ventas − devoluciones del periodo (por fecha de devolución).
 * - Importes «sin IVA» usan el neto de las líneas; «total» incluye impuestos.
 * - Utilidad = Σ (neto − costo) de las líneas con costo, menos lo mismo de lo
 *   devuelto. Las líneas sin costo no entran: se reporta su venta como
 *   «sin costo» y la utilidad se marca incompleta.
 * - Fechas y horas en la zona horaria de la empresa.
 */

export type ReportFilter = { companyId: string; tz: string; currency: string; branchIds: string[]; branchLabel: string; period: Period; showProfit: boolean };

/** Filtro a partir de los parámetros de la URL; la sucursal debe ser accesible. */
export function reportFilter(ctx: ServiceContext, params: { periodo?: string; desde?: string; hasta?: string; sucursal?: string }): ReportFilter {
  requirePermission(ctx, "reports.view");
  const company = requireCompany(ctx);
  const accessible = ctx.branches.map((b) => b.id);
  const one = params.sucursal && accessible.includes(params.sucursal) ? params.sucursal : null;
  return {
    companyId: company.id,
    tz: company.timezone,
    currency: company.currency,
    branchIds: one ? [one] : accessible.length ? accessible : ["00000000-0000-0000-0000-000000000000"],
    branchLabel: one ? (ctx.branches.find((b) => b.id === one)?.name ?? "") : accessible.length > 1 ? "Todas las sucursales" : (ctx.branches[0]?.name ?? ""),
    period: resolvePeriod(company.timezone, { preset: params.periodo, from: params.desde, to: params.hasta }),
    showProfit: hasPermission(ctx, "reports.view_profit"),
  };
}

async function q<T>(query: SQL): Promise<T[]> {
  return (await db.execute(query)).rows as T[];
}
const n = (v: unknown) => Number(v ?? 0);
const branches = (f: ReportFilter) => sql`(${sql.join(f.branchIds.map((b) => sql`${b}::uuid`), sql`, `)})`;

// ---------------------------------------------------------------- Resumen

export type Summary = {
  tickets: number;
  gross: number;
  net: number;
  tax: number;
  discount: number;
  returnsCount: number;
  returnsTotal: number;
  returnsNet: number;
  netSales: number;
  netRevenue: number;
  avgTicket: number;
  customers: number;
  cancelledCount: number;
  cancelledTotal: number;
  profit: number;
  uncostedSales: number;
  margin: number | null;
  profitComplete: boolean;
};

async function summaryFor(f: ReportFilter, from: Date, to: Date): Promise<Summary> {
  const [s] = await q<Record<string, unknown>>(sql`
    select count(*) filter (where status = 'completed') as tickets,
           coalesce(sum(total) filter (where status = 'completed'), 0) as gross,
           coalesce(sum(subtotal) filter (where status = 'completed'), 0) as net,
           coalesce(sum(tax_total) filter (where status = 'completed'), 0) as tax,
           coalesce(sum(discount_total) filter (where status = 'completed'), 0) as discount,
           count(distinct customer_id) filter (where status = 'completed') as customers,
           count(*) filter (where status = 'cancelled') as cancelled_count,
           coalesce(sum(total) filter (where status = 'cancelled'), 0) as cancelled_total
    from sales where company_id = ${f.companyId} and branch_id in ${branches(f)} and sold_at >= ${from} and sold_at < ${to}`);
  const [l] = await q<Record<string, unknown>>(sql`
    select coalesce(sum(l.net_amount - round(l.unit_cost * l.quantity)) filter (where l.unit_cost is not null), 0) as profit,
           coalesce(sum(l.net_amount) filter (where l.unit_cost is null), 0) as uncosted
    from sale_lines l join sales s on s.id = l.sale_id
    where s.company_id = ${f.companyId} and s.branch_id in ${branches(f)} and s.status = 'completed' and s.sold_at >= ${from} and s.sold_at < ${to}`);
  const [r] = await q<Record<string, unknown>>(sql`
    select count(distinct r.id) as n, coalesce(sum(rl.line_total), 0) as total, coalesce(sum(rl.net_amount), 0) as net,
           coalesce(sum(rl.net_amount - round(rl.unit_cost * rl.quantity)) filter (where rl.unit_cost is not null), 0) as profit,
           coalesce(sum(rl.net_amount) filter (where rl.unit_cost is null), 0) as uncosted
    from sale_returns r join sale_return_lines rl on rl.return_id = r.id
    where r.company_id = ${f.companyId} and r.branch_id in ${branches(f)} and r.created_at >= ${from} and r.created_at < ${to}`);
  const tickets = n(s.tickets);
  const netRevenue = n(s.net) - n(r.net);
  const profit = n(l.profit) - n(r.profit);
  const uncosted = n(l.uncosted) - n(r.uncosted);
  const costedRevenue = netRevenue - uncosted;
  return {
    tickets,
    gross: n(s.gross),
    net: n(s.net),
    tax: n(s.tax),
    discount: n(s.discount),
    returnsCount: n(r.n),
    returnsTotal: n(r.total),
    returnsNet: n(r.net),
    netSales: n(s.gross) - n(r.total),
    netRevenue,
    avgTicket: tickets ? Math.round(n(s.gross) / tickets) : 0,
    customers: n(s.customers),
    cancelledCount: n(s.cancelled_count),
    cancelledTotal: n(s.cancelled_total),
    profit: f.showProfit ? profit : 0,
    uncostedSales: f.showProfit ? Math.max(0, uncosted) : 0,
    margin: f.showProfit && costedRevenue > 0 ? Math.round((profit / costedRevenue) * 1000) / 10 : null,
    profitComplete: uncosted <= 0,
  };
}

export async function getSummary(f: ReportFilter) {
  const [current, previous] = await Promise.all([summaryFor(f, f.period.from, f.period.to), summaryFor(f, f.period.previous.from, f.period.previous.to)]);
  return { current, previous };
}

// ---------------------------------------------------------------- Series

/** Venta por día local (rellena días sin venta con cero). */
export async function salesByDay(f: ReportFilter) {
  const rows = await q<{ day: string; tickets: number; total: number; net: number }>(sql`
    select to_char(sold_at at time zone ${f.tz}, 'YYYY-MM-DD') as day, count(*) as tickets, sum(total) as total, sum(subtotal) as net
    from sales where company_id = ${f.companyId} and branch_id in ${branches(f)} and status = 'completed' and sold_at >= ${f.period.from} and sold_at < ${f.period.to}
    group by 1 order by 1`);
  const rets = await q<{ day: string; total: number }>(sql`
    select to_char(created_at at time zone ${f.tz}, 'YYYY-MM-DD') as day, sum(total) as total
    from sale_returns where company_id = ${f.companyId} and branch_id in ${branches(f)} and created_at >= ${f.period.from} and created_at < ${f.period.to}
    group by 1`);
  const out: Array<{ day: string; tickets: number; total: number; returns: number; netSales: number }> = [];
  for (let d = f.period.fromDay; d <= f.period.toDay; ) {
    const r = rows.find((x) => x.day === d);
    const ret = n(rets.find((x) => x.day === d)?.total);
    out.push({ day: d, tickets: n(r?.tickets), total: n(r?.total), returns: ret, netSales: n(r?.total) - ret });
    const next = new Date(`${d}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    d = next.toISOString().slice(0, 10);
  }
  return out;
}

/** Venta por hora del día y por día de la semana (para saber cuándo reforzar personal). */
export async function salesByHour(f: ReportFilter) {
  const rows = await q<{ dow: number; hour: number; tickets: number; total: number }>(sql`
    select extract(dow from sold_at at time zone ${f.tz})::int as dow, extract(hour from sold_at at time zone ${f.tz})::int as hour, count(*) as tickets, sum(total) as total
    from sales where company_id = ${f.companyId} and branch_id in ${branches(f)} and status = 'completed' and sold_at >= ${f.period.from} and sold_at < ${f.period.to}
    group by 1, 2`);
  const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, tickets: 0, total: 0 }));
  const byDow = Array.from({ length: 7 }, (_, d) => ({ dow: d, tickets: 0, total: 0 }));
  for (const r of rows) {
    byHour[n(r.hour)].tickets += n(r.tickets);
    byHour[n(r.hour)].total += n(r.total);
    byDow[n(r.dow)].tickets += n(r.tickets);
    byDow[n(r.dow)].total += n(r.total);
  }
  return { byHour, byDow };
}

// ---------------------------------------------------------------- Desgloses de venta

export async function salesByBranch(f: ReportFilter) {
  const rows = await q<Record<string, unknown>>(sql`
    select b.id, b.name, count(s.id) as tickets, coalesce(sum(s.total), 0) as total, coalesce(sum(s.subtotal), 0) as net,
           coalesce((select sum(l.net_amount - round(l.unit_cost * l.quantity)) from sale_lines l join sales s2 on s2.id = l.sale_id where s2.branch_id = b.id and s2.status = 'completed' and s2.sold_at >= ${f.period.from} and s2.sold_at < ${f.period.to} and l.unit_cost is not null), 0) as profit,
           coalesce((select sum(l.net_amount) from sale_lines l join sales s2 on s2.id = l.sale_id where s2.branch_id = b.id and s2.status = 'completed' and s2.sold_at >= ${f.period.from} and s2.sold_at < ${f.period.to} and l.unit_cost is null), 0) as uncosted,
           coalesce((select sum(r.total) from sale_returns r where r.branch_id = b.id and r.created_at >= ${f.period.from} and r.created_at < ${f.period.to}), 0) as returns
    from branches b left join sales s on s.branch_id = b.id and s.status = 'completed' and s.sold_at >= ${f.period.from} and s.sold_at < ${f.period.to}
    where b.company_id = ${f.companyId} and b.id in ${branches(f)}
    group by b.id, b.name order by total desc`);
  return rows.map((r) => ({ id: String(r.id), name: String(r.name), tickets: n(r.tickets), total: n(r.total), returns: n(r.returns), netSales: n(r.total) - n(r.returns), avgTicket: n(r.tickets) ? Math.round(n(r.total) / n(r.tickets)) : 0, profit: f.showProfit ? n(r.profit) : null, uncosted: n(r.uncosted) }));
}

export async function salesByPaymentMethod(f: ReportFilter) {
  const rows = await q<Record<string, unknown>>(sql`
    select pm.name, p.kind, count(*) as count, sum(p.amount) as amount
    from payments p join sales s on s.id = p.sale_id join payment_methods pm on pm.id = p.payment_method_id
    where s.company_id = ${f.companyId} and s.branch_id in ${branches(f)} and s.status = 'completed' and s.sold_at >= ${f.period.from} and s.sold_at < ${f.period.to}
    group by pm.name, p.kind order by amount desc`);
  const total = rows.reduce((a, r) => a + n(r.amount), 0);
  return rows.map((r) => ({ name: String(r.name), kind: String(r.kind), count: n(r.count), amount: n(r.amount), share: total ? Math.round((n(r.amount) / total) * 1000) / 10 : 0 }));
}

export async function salesBySeller(f: ReportFilter) {
  const rows = await q<Record<string, unknown>>(sql`
    select u.full_name as name, count(*) as tickets, sum(s.total) as total, sum(s.discount_total) as discount,
           count(*) filter (where s.customer_id is not null) as with_customer
    from sales s join users u on u.id = s.sold_by
    where s.company_id = ${f.companyId} and s.branch_id in ${branches(f)} and s.status = 'completed' and s.sold_at >= ${f.period.from} and s.sold_at < ${f.period.to}
    group by u.full_name order by total desc`);
  return rows.map((r) => ({ name: String(r.name), tickets: n(r.tickets), total: n(r.total), avgTicket: n(r.tickets) ? Math.round(n(r.total) / n(r.tickets)) : 0, discount: n(r.discount), withCustomer: n(r.with_customer) }));
}

// ---------------------------------------------------------------- Productos y categorías

export type ProductRow = { variantId: string; sku: string; name: string; category: string; qty: number; returnedQty: number; total: number; net: number; profit: number | null; margin: number | null; uncosted: boolean; tickets: number };

export async function productsReport(f: ReportFilter, opts: { limit?: number } = {}): Promise<ProductRow[]> {
  const rows = await q<Record<string, unknown>>(sql`
    with sold as (
      select l.variant_id, sum(l.quantity) as qty, sum(l.line_total) as total, sum(l.net_amount) as net,
             sum(l.net_amount - round(l.unit_cost * l.quantity)) filter (where l.unit_cost is not null) as profit,
             bool_or(l.unit_cost is null) as uncosted, count(distinct l.sale_id) as tickets
      from sale_lines l join sales s on s.id = l.sale_id
      where s.company_id = ${f.companyId} and s.branch_id in ${branches(f)} and s.status = 'completed' and s.sold_at >= ${f.period.from} and s.sold_at < ${f.period.to}
      group by l.variant_id),
    ret as (
      select rl.variant_id, sum(rl.quantity) as qty, sum(rl.line_total) as total, sum(rl.net_amount) as net,
             sum(rl.net_amount - round(rl.unit_cost * rl.quantity)) filter (where rl.unit_cost is not null) as profit
      from sale_return_lines rl join sale_returns r on r.id = rl.return_id
      where r.company_id = ${f.companyId} and r.branch_id in ${branches(f)} and r.created_at >= ${f.period.from} and r.created_at < ${f.period.to}
      group by rl.variant_id)
    select v.id, v.sku, p.name || case when v.variant_name <> '' then ' · ' || v.variant_name else '' end as name, coalesce(c.name, 'Sin categoría') as category,
           coalesce(sold.qty, 0) as qty, coalesce(ret.qty, 0) as rqty, coalesce(sold.total, 0) - coalesce(ret.total, 0) as total,
           coalesce(sold.net, 0) - coalesce(ret.net, 0) as net, coalesce(sold.profit, 0) - coalesce(ret.profit, 0) as profit,
           coalesce(sold.uncosted, false) as uncosted, coalesce(sold.tickets, 0) as tickets
    from (select variant_id from sold union select variant_id from ret) ids
    join product_variants v on v.id = ids.variant_id join products p on p.id = v.product_id left join categories c on c.id = p.category_id
    left join sold on sold.variant_id = v.id left join ret on ret.variant_id = v.id
    order by total desc limit ${opts.limit ?? 500}`);
  return rows.map((r) => {
    const net = n(r.net);
    const profit = f.showProfit && !r.uncosted ? n(r.profit) : null;
    return { variantId: String(r.id), sku: String(r.sku), name: String(r.name), category: String(r.category), qty: n(r.qty), returnedQty: n(r.rqty), total: n(r.total), net, profit, margin: profit !== null && net > 0 ? Math.round((profit / net) * 1000) / 10 : null, uncosted: Boolean(r.uncosted), tickets: n(r.tickets) };
  });
}

export function categoriesFrom(products: ProductRow[], showProfit: boolean) {
  const map = new Map<string, { category: string; qty: number; total: number; net: number; profit: number; uncosted: boolean; products: number; costed: number }>();
  for (const p of products) {
    const c = map.get(p.category) ?? { category: p.category, qty: 0, total: 0, net: 0, profit: 0, uncosted: false, products: 0, costed: 0 };
    c.qty += p.qty - p.returnedQty;
    c.total += p.total;
    c.net += p.net;
    c.products += 1;
    if (p.profit === null) c.uncosted = true;
    else {
      c.profit += p.profit;
      c.costed += 1;
    }
    map.set(p.category, c);
  }
  const total = [...map.values()].reduce((a, c) => a + c.total, 0);
  return [...map.values()]
    // Si en la categoría hay productos sin costo, la utilidad es parcial (marcada con `uncosted`) y el margen no se calcula.
    .map((c) => ({ ...c, profit: showProfit && c.costed ? c.profit : null, margin: showProfit && c.net > 0 && !c.uncosted ? Math.round((c.profit / c.net) * 1000) / 10 : null, share: total ? Math.round((c.total / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------- Inventario

/** Valor y cobertura por producto en los almacenes de las sucursales del filtro. */
export async function inventoryReport(f: ReportFilter) {
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const rows = await q<Record<string, unknown>>(sql`
    select v.id, v.sku, p.name || case when v.variant_name <> '' then ' · ' || v.variant_name else '' end as name, coalesce(c.name, 'Sin categoría') as category,
           sum(b.on_hand) as on_hand,
           case when sum(b.on_hand) > 0 then round(sum(b.on_hand * b.avg_cost) / nullif(sum(b.on_hand) filter (where b.avg_cost is not null), 0)) end as avg_cost,
           sum(round(b.on_hand * b.avg_cost)) filter (where b.avg_cost is not null and b.on_hand > 0) as value,
           bool_or(b.avg_cost is null and b.on_hand > 0) as uncosted,
           (select -coalesce(sum(il.quantity), 0) from inventory_ledger il where il.variant_id = v.id and il.movement_type in ('sale_out', 'sale_cancel_in') and il.branch_id in ${branches(f)} and il.created_at >= ${since30}) as sold30,
           (select max(il.created_at) from inventory_ledger il where il.variant_id = v.id and il.movement_type = 'sale_out' and il.branch_id in ${branches(f)}) as last_sale,
           v.reorder_point
    from stock_balances b join product_variants v on v.id = b.variant_id join products p on p.id = v.product_id left join categories c on c.id = p.category_id
    join warehouses w on w.id = b.warehouse_id
    where w.company_id = ${f.companyId} and w.branch_id in ${branches(f)} and p.track_stock
    group by v.id, v.sku, p.name, v.variant_name, c.name, v.reorder_point
    order by value desc nulls last`);
  return rows.map((r) => {
    const onHand = n(r.on_hand);
    const daily = n(r.sold30) / 30;
    return {
      variantId: String(r.id),
      sku: String(r.sku),
      name: String(r.name),
      category: String(r.category),
      onHand,
      avgCost: f.showProfit && r.avg_cost !== null ? n(r.avg_cost) : null,
      value: f.showProfit ? n(r.value) : null,
      uncosted: Boolean(r.uncosted),
      sold30: n(r.sold30),
      coverageDays: daily > 0 ? Math.round(onHand / daily) : null,
      lastSale: r.last_sale ? new Date(String(r.last_sale)) : null,
      reorderPoint: r.reorder_point === null ? null : n(r.reorder_point),
    };
  });
}

// ---------------------------------------------------------------- Clientes

export async function customersReport(f: ReportFilter) {
  const top = await q<Record<string, unknown>>(sql`
    select c.id, c.code, c.name, count(s.id) as tickets, sum(s.total) as total, max(s.sold_at) as last_purchase
    from sales s join customers c on c.id = s.customer_id
    where s.company_id = ${f.companyId} and s.branch_id in ${branches(f)} and s.status = 'completed' and s.sold_at >= ${f.period.from} and s.sold_at < ${f.period.to}
    group by c.id, c.code, c.name order by total desc limit 50`);
  const [mix] = await q<Record<string, unknown>>(sql`
    select count(distinct s.customer_id) filter (where c.first_purchase_at >= ${f.period.from}) as new_customers,
           count(distinct s.customer_id) filter (where c.first_purchase_at < ${f.period.from}) as returning,
           count(*) filter (where s.customer_id is null) as anonymous_tickets,
           coalesce(sum(s.total) filter (where s.customer_id is null), 0) as anonymous_total,
           coalesce(sum(s.total) filter (where s.customer_id is not null), 0) as identified_total
    from sales s left join customers c on c.id = s.customer_id
    where s.company_id = ${f.companyId} and s.branch_id in ${branches(f)} and s.status = 'completed' and s.sold_at >= ${f.period.from} and s.sold_at < ${f.period.to}`);
  return {
    top: top.map((r) => ({ id: String(r.id), code: String(r.code), name: String(r.name), tickets: n(r.tickets), total: n(r.total), avgTicket: n(r.tickets) ? Math.round(n(r.total) / n(r.tickets)) : 0, lastPurchase: new Date(String(r.last_purchase)) })),
    newCustomers: n(mix.new_customers),
    returning: n(mix.returning),
    anonymousTickets: n(mix.anonymous_tickets),
    anonymousTotal: n(mix.anonymous_total),
    identifiedTotal: n(mix.identified_total),
  };
}

// ---------------------------------------------------------------- Promociones

export async function promotionsReport(f: ReportFilter) {
  const rows = await q<Record<string, unknown>>(sql`
    select p.id, p.name, p.kind, count(r.id) as uses, sum(r.amount) as discount, count(distinct r.coupon_id) as coupons, sum(s.total) as sales
    from promotion_redemptions r join promotions p on p.id = r.promotion_id join sales s on s.id = r.sale_id
    where r.company_id = ${f.companyId} and r.status = 'applied' and s.branch_id in ${branches(f)} and s.status = 'completed' and s.sold_at >= ${f.period.from} and s.sold_at < ${f.period.to}
    group by p.id, p.name, p.kind order by discount desc`);
  const [manual] = await q<Record<string, unknown>>(sql`
    select coalesce(sum(l.discount_amount - l.promotion_discount), 0) as manual, coalesce(sum(l.promotion_discount), 0) as promo
    from sale_lines l join sales s on s.id = l.sale_id
    where s.company_id = ${f.companyId} and s.branch_id in ${branches(f)} and s.status = 'completed' and s.sold_at >= ${f.period.from} and s.sold_at < ${f.period.to}`);
  return {
    promotions: rows.map((r) => ({ id: String(r.id), name: String(r.name), kind: String(r.kind), uses: n(r.uses), discount: n(r.discount), coupons: n(r.coupons), sales: n(r.sales) })),
    manualDiscount: n(manual.manual),
    promoDiscount: n(manual.promo),
  };
}

// ---------------------------------------------------------------- Caja

export async function cashReport(f: ReportFilter) {
  const rows = await q<Record<string, unknown>>(sql`
    select cs.id, br.name as branch, cr.name as register, uo.full_name as opened_by, uc.full_name as closed_by, cs.opened_at, cs.closed_at,
           cs.expected_cash, cs.counted_cash, cs.difference, (cs.closing_summary->>'salesTotal')::bigint as sales_total, (cs.closing_summary->>'salesCount')::int as sales_count
    from cash_sessions cs join cash_registers cr on cr.id = cs.cash_register_id join branches br on br.id = cs.branch_id
    join users uo on uo.id = cs.opened_by left join users uc on uc.id = cs.closed_by
    where cs.company_id = ${f.companyId} and cs.branch_id in ${branches(f)} and cs.status = 'closed' and cs.closed_at >= ${f.period.from} and cs.closed_at < ${f.period.to}
    order by cs.closed_at desc`);
  const list = rows.map((r) => ({ id: String(r.id), branch: String(r.branch), register: String(r.register), openedBy: String(r.opened_by), closedBy: r.closed_by ? String(r.closed_by) : "", openedAt: new Date(String(r.opened_at)), closedAt: new Date(String(r.closed_at)), expected: n(r.expected_cash), counted: n(r.counted_cash), difference: n(r.difference), salesTotal: n(r.sales_total), salesCount: n(r.sales_count) }));
  return { sessions: list, short: list.filter((s) => s.difference < 0).reduce((a, s) => a + s.difference, 0), over: list.filter((s) => s.difference > 0).reduce((a, s) => a + s.difference, 0) };
}
