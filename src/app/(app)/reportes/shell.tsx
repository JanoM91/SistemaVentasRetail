import type { ReactNode } from "react";
import { Alert, Card, PageHeader, Table } from "@/components/ui";
import { SectionTabs } from "@/components/section-tabs";
import type { RequestContext } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import type { ReportFilter } from "@/server/modules/reports/service";
import { REPORTS, type ReportKey } from "@/server/modules/reports/tables";
import type { ReportDocument, ReportTable } from "@/server/modules/reports/export";
import { PERIOD_PRESETS } from "@/lib/period";
import { formatCents, formatQty } from "@/lib/money";

export type ReportParams = { periodo?: string; desde?: string; hasta?: string; sucursal?: string };

const HREF: Record<ReportKey, string> = { resumen: "/reportes", ventas: "/reportes/ventas", productos: "/reportes/productos", inventario: "/reportes/inventario", clientes: "/reportes/clientes", promociones: "/reportes/promociones", caja: "/reportes/caja" };

export function qs(p: ReportParams, extra: Record<string, string> = {}) {
  const s = new URLSearchParams(Object.entries({ ...p, ...extra }).filter(([, v]) => v) as Array<[string, string]>);
  return s.size ? `?${s}` : "";
}

/** Encabezado, filtros (periodo, fechas, sucursal), pestañas y exportación comunes a todos los reportes. */
export function ReportShell({ ctx, f, params, active, children }: { ctx: RequestContext; f: ReportFilter; params: ReportParams; active: ReportKey; children: ReactNode }) {
  const canExport = hasPermission(ctx, "reports.export");
  const keep = { periodo: f.period.preset === "personalizado" ? "" : f.period.preset, desde: f.period.preset === "personalizado" ? f.period.fromDay : "", hasta: f.period.preset === "personalizado" ? f.period.toDay : "", sucursal: params.sucursal ?? "" };
  return (
    <>
      <PageHeader
        title="Reportes"
        description={<>{f.period.label} · {f.branchLabel} <span className="text-muted">· comparado con {f.period.previous.label}</span></>}
        actions={
          canExport && (
            <div className="flex flex-wrap gap-2 print:hidden" aria-label="Exportar">
              {(["xlsx", "csv", "pdf"] as const).map((fmt) => (
                <a key={fmt} download className="inline-flex min-h-11 items-center rounded-app border border-border px-4 text-sm font-medium hover:bg-surface-2" href={`/api/v1/reports/export${qs(keep, { reporte: active, formato: fmt })}`} data-testid={`export-${fmt}`}>
                  {fmt === "xlsx" ? "Excel" : fmt.toUpperCase()}
                </a>
              ))}
            </div>
          )
        }
      />
      <SectionTabs active={HREF[active]} tabs={(Object.keys(REPORTS) as ReportKey[]).map((k) => ({ href: `${HREF[k]}${qs(keep)}`, label: REPORTS[k] }))} />
      <Card className="mb-4 print:hidden">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[210px_160px_160px_1fr_auto]">
          <select name="periodo" defaultValue={f.period.preset === "personalizado" ? "" : f.period.preset} className="field" aria-label="Periodo">
            {Object.entries(PERIOD_PRESETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            <option value="">Fechas…</option>
          </select>
          <input type="date" name="desde" defaultValue={f.period.fromDay} className="field" aria-label="Desde" />
          <input type="date" name="hasta" defaultValue={f.period.toDay} className="field" aria-label="Hasta" />
          <select name="sucursal" defaultValue={params.sucursal ?? ""} className="field" aria-label="Sucursal">
            {ctx.branches.length > 1 && <option value="">Todas las sucursales</option>}
            {ctx.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button className="min-h-11 rounded-app bg-primary px-4 text-sm font-medium text-primary-fg">Ver</button>
        </form>
        <p className="mt-2 text-xs text-muted">Para fechas específicas elige «Fechas…» en el periodo.</p>
      </Card>
      {!f.showProfit && <div className="mb-4"><Alert tone="info">No tienes permiso para ver costos y utilidades; esas columnas no se muestran.</Alert></div>}
      {children}
    </>
  );
}

function fmtCell(v: unknown, type: ReportTable["columns"][number]["type"], currency: string, tz: string) {
  if (v === null || v === undefined || v === "") return <span className="text-muted">—</span>;
  switch (type) {
    case "money": return formatCents(Number(v), currency);
    case "percent": return `${Number(v).toFixed(1)} %`;
    case "qty": return formatQty(Number(v));
    case "int": return Number(v).toLocaleString("es-MX");
    case "date": return v instanceof Date ? new Intl.DateTimeFormat("es-MX", { timeZone: tz, dateStyle: "short", timeStyle: "short" }).format(v) : String(v);
    default: return String(v);
  }
}

/** Tablas del reporte, iguales a lo que se exporta. */
export function ReportTables({ doc, skip = [], limit }: { doc: ReportDocument; skip?: string[]; limit?: number }) {
  return (
    <div className="space-y-6">
      {doc.tables.filter((t) => !skip.includes(t.title)).map((t) => (
        <Card key={t.title} title={t.title}>
          {t.note && <div className="mb-3"><Alert tone="warning">{t.note}</Alert></div>}
          {t.rows.length === 0 ? (
            <p className="text-sm text-muted">Sin datos en el periodo.</p>
          ) : (
            <Table className="border-0">
              <thead>
                <tr>{t.columns.map((c) => <th key={c.key} className={c.type === "text" ? "" : "text-right"}>{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {(limit ? t.rows.slice(0, limit) : t.rows).map((r, i) => (
                  <tr key={i}>{t.columns.map((c) => <td key={c.key} className={c.type === "text" ? "" : "text-right tabular-nums"}>{fmtCell(r[c.key], c.type, doc.currency, doc.tz)}</td>)}</tr>
                ))}
              </tbody>
              {t.totals && (
                <tfoot>
                  <tr className="font-semibold">{t.columns.map((c, i) => <td key={c.key} className={c.type === "text" ? "" : "text-right tabular-nums"}>{i === 0 ? "Total" : t.totals![c.key] === undefined ? "" : fmtCell(t.totals![c.key], c.type, doc.currency, doc.tz)}</td>)}</tr>
                </tfoot>
              )}
            </Table>
          )}
          {limit && t.rows.length > limit && <p className="mt-2 text-xs text-muted">Se muestran {limit} de {t.rows.length}. La exportación incluye todos.</p>}
        </Card>
      ))}
    </div>
  );
}
