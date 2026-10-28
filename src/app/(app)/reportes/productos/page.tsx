import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { BarList } from "@/components/charts/bar-list";
import { formatCents } from "@/lib/money";
import { ReportPage, rowsOf } from "../report-page";
import type { ReportParams } from "../shell";

export const metadata: Metadata = { title: "Productos y utilidad" };

type Cat = { category: string; total: number; profit: number | null; margin: number | null };
type Prod = { name: string; total: number; profit: number | null; margin: number | null; qty: number };

export default function ProductsReport({ searchParams }: { searchParams: Promise<ReportParams> }) {
  return (
    <ReportPage
      searchParams={searchParams}
      report="productos"
      limit={200}
      top={({ f, doc }) => {
        const money = (c: number) => formatCents(c, f.currency);
        const prods = rowsOf<Prod>(doc, "Por producto");
        const byProfit = [...prods].filter((p) => p.profit !== null).sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0));
        return (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Venta por categoría">
              <BarList ariaLabel="Venta por categoría" items={rowsOf<Cat>(doc, "Por categoría").map((c) => ({ label: c.category, value: c.total, display: money(c.total), hint: f.showProfit ? (c.margin === null ? "margen incompleto" : `margen ${c.margin.toFixed(1)} %`) : undefined }))} />
            </Card>
            {f.showProfit ? (
              <Card title="Productos que más utilidad dejan">
                <BarList ariaLabel="Utilidad por producto" items={byProfit.slice(0, 8).map((p) => ({ label: p.name, value: Math.max(0, p.profit ?? 0), display: money(p.profit ?? 0), hint: p.margin === null ? undefined : `margen ${p.margin.toFixed(1)} %` }))} />
              </Card>
            ) : (
              <Card title="Productos más vendidos">
                <BarList ariaLabel="Venta por producto" items={prods.slice(0, 8).map((p) => ({ label: p.name, value: p.total, display: money(p.total) }))} />
              </Card>
            )}
          </div>
        );
      }}
    />
  );
}
