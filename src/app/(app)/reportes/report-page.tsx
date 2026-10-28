import type { ReactNode } from "react";
import { Alert } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import type { RequestContext } from "@/server/context";
import { reportFilter, type ReportFilter } from "@/server/modules/reports/service";
import { buildReport, type ReportKey } from "@/server/modules/reports/tables";
import type { ReportDocument } from "@/server/modules/reports/export";
import { ReportShell, ReportTables, type ReportParams } from "./shell";

/** Filas de una tabla del documento por título (para graficar lo mismo que se exporta). */
export function rowsOf<T = Record<string, unknown>>(doc: ReportDocument, title: string): T[] {
  return (doc.tables.find((t) => t.title === title)?.rows ?? []) as T[];
}

/** Página de reporte estándar: filtros + (encabezado visual opcional) + tablas idénticas a la exportación. */
export async function ReportPage({ searchParams, report, limit, top }: { searchParams: Promise<ReportParams>; report: ReportKey; limit?: number; top?: (x: { ctx: RequestContext; f: ReportFilter; doc: ReportDocument }) => ReactNode }) {
  const ctx = await requirePagePermission("reports.view");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const params = await searchParams;
  const f = reportFilter(ctx, params);
  const doc = await buildReport(ctx, f, report);
  return (
    <ReportShell ctx={ctx} f={f} params={params} active={report}>
      {top && <div className="mb-6">{top({ ctx, f, doc })}</div>}
      <ReportTables doc={doc} limit={limit} />
    </ReportShell>
  );
}
