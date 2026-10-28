import type { Metadata } from "next";
import { Stat } from "@/components/ui";
import { formatCents } from "@/lib/money";
import { ReportPage, rowsOf } from "../report-page";
import type { ReportParams } from "../shell";

export const metadata: Metadata = { title: "Reporte de inventario" };

type Inv = { onHand: number; value: number | null; coverageDays: number | null; sold30: number; reorderPoint: number | null };

export default function InventoryReport({ searchParams }: { searchParams: Promise<ReportParams> }) {
  return (
    <ReportPage
      searchParams={searchParams}
      report="inventario"
      limit={300}
      top={({ f, doc }) => {
        const inv = rowsOf<Inv>(doc, "Existencias y cobertura");
        return (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {f.showProfit && <Stat label="Valor del inventario" value={formatCents(inv.reduce((a, r) => a + (r.value ?? 0), 0), f.currency)} hint="a costo promedio" />}
              <Stat label="Sin existencia" value={inv.filter((r) => r.onHand <= 0).length} hint="productos en cero o negativo" />
              <Stat label="Cobertura menor a 7 días" value={inv.filter((r) => r.coverageDays !== null && r.coverageDays < 7).length} hint="según la venta de los últimos 30 días" />
              <Stat label="Sin venta en 30 días" value={inv.filter((r) => r.onHand > 0 && r.sold30 <= 0).length} hint="inventario detenido" />
            </div>
            <p className="mt-2 text-xs text-muted">Existencias al momento. La cobertura usa la venta de los últimos 30 días, sin importar el periodo elegido.</p>
          </>
        );
      }}
    />
  );
}
