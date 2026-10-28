import { NextResponse, type NextRequest } from "next/server";
import { getRequestContext } from "@/server/context";
import { DomainError } from "@/server/errors";
import { requirePermission } from "@/server/authz/guard";
import { recordAudit } from "@/server/audit";
import { db } from "@/server/db";
import { reportFilter } from "@/server/modules/reports/service";
import { buildReport, REPORTS, type ReportKey } from "@/server/modules/reports/tables";
import { toCsv, toPdf, toXlsx } from "@/server/modules/reports/export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TYPES = { csv: "text/csv; charset=utf-8", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pdf: "application/pdf" } as const;

/** Descarga de un reporte: ?reporte=ventas&formato=xlsx&periodo=mes&sucursal=… */
export async function GET(req: NextRequest) {
  const ctx = await getRequestContext();
  if (!ctx) return NextResponse.json({ ok: false, error: "Tu sesión expiró." }, { status: 401 });
  try {
    requirePermission(ctx, "reports.export");
    const p = Object.fromEntries(req.nextUrl.searchParams);
    const key = (p.reporte in REPORTS ? p.reporte : "resumen") as ReportKey;
    const format = (p.formato in TYPES ? p.formato : "csv") as keyof typeof TYPES;
    const f = reportFilter(ctx, p);
    const doc = await buildReport(ctx, f, key);
    const body = format === "csv" ? toCsv(doc) : format === "xlsx" ? await toXlsx(doc) : await toPdf(doc);
    await recordAudit(db, ctx.actor, { action: "reports.export", entity: "report", after: { report: key, format, period: f.period.label, branch: f.branchLabel } });
    const name = `${key}-${f.period.fromDay}_a_${f.period.toDay}.${format}`;
    return new NextResponse(body as BodyInit, { headers: { "Content-Type": TYPES[format], "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    console.error("[reports.export]", e);
    return NextResponse.json({ ok: false, error: "No se pudo generar el reporte." }, { status: 500 });
  }
}
