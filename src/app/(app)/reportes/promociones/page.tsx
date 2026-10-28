import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { BarList } from "@/components/charts/bar-list";
import { formatCents } from "@/lib/money";
import { ReportPage, rowsOf } from "../report-page";
import type { ReportParams } from "../shell";

export const metadata: Metadata = { title: "Reporte de promociones" };

type Promo = { name: string; uses: number; discount: number };

export default function PromotionsReport({ searchParams }: { searchParams: Promise<ReportParams> }) {
  return (
    <ReportPage
      searchParams={searchParams}
      report="promociones"
      top={({ f, doc }) => (
        <Card title="Descuento otorgado por promoción">
          <BarList ariaLabel="Descuento por promoción" items={rowsOf<Promo>(doc, "Promociones aplicadas").map((p) => ({ label: p.name, value: p.discount, display: formatCents(p.discount, f.currency), hint: `${p.uses} usos` }))} />
        </Card>
      )}
    />
  );
}
