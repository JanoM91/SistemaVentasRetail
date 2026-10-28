import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { ColumnChart } from "@/components/charts/column-chart";
import { BarList } from "@/components/charts/bar-list";
import { formatCents } from "@/lib/money";
import { ReportPage, rowsOf } from "../report-page";
import type { ReportParams } from "../shell";

export const metadata: Metadata = { title: "Reporte de ventas" };

type Hour = { hour: number; tickets: number; total: number };
type Dow = { label: string; tickets: number; total: number };
type Branch = { name: string; total: number; netSales: number; tickets: number };
type Seller = { name: string; total: number; tickets: number };

export default function SalesReport({ searchParams }: { searchParams: Promise<ReportParams> }) {
  return (
    <ReportPage
      searchParams={searchParams}
      report="ventas"
      top={({ f, doc }) => {
        const money = (c: number) => formatCents(c, f.currency);
        const hours = rowsOf<Hour>(doc, "Por hora");
        const byHour = Array.from({ length: 24 }, (_, h) => hours.find((x) => x.hour === h) ?? { hour: h, tickets: 0, total: 0 });
        const first = Math.min(8, ...hours.map((h) => h.hour));
        const last = Math.max(21, ...hours.map((h) => h.hour));
        const dows = rowsOf<Dow>(doc, "Por día de la semana");
        // Semana empezando en lunes.
        const week = [...dows.slice(1), dows[0]].filter(Boolean);
        return (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Venta por hora del día">
              <ColumnChart scale={100} ariaLabel="Venta por hora del día" maxLabels={16} data={byHour.slice(first, last + 1).map((h) => ({ label: String(h.hour), value: h.total, tooltip: `${String(h.hour).padStart(2, "0")}:00–${String(h.hour).padStart(2, "0")}:59 · ${money(h.total)} · ${h.tickets} tickets` }))} />
            </Card>
            <Card title="Venta por día de la semana">
              <ColumnChart scale={100} ariaLabel="Venta por día de la semana" data={week.map((d) => ({ label: d.label.slice(0, 3), value: d.total, tooltip: `${d.label} · ${money(d.total)} · ${d.tickets} tickets` }))} />
            </Card>
            <Card title="Por sucursal">
              <BarList ariaLabel="Venta neta por sucursal" items={rowsOf<Branch>(doc, "Por sucursal").map((b) => ({ label: b.name, value: b.netSales, display: money(b.netSales), hint: `${b.tickets} tickets` }))} />
            </Card>
            <Card title="Por vendedor">
              <BarList ariaLabel="Venta por vendedor" items={rowsOf<Seller>(doc, "Por vendedor").map((s) => ({ label: s.name, value: s.total, display: money(s.total), hint: `${s.tickets} tickets` }))} />
            </Card>
          </div>
        );
      }}
    />
  );
}
