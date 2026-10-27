import { NextResponse } from "next/server";
import { getRequestContext } from "@/server/context";
import { DomainError } from "@/server/errors";
import { exportCustomersCsv } from "@/server/modules/customers/service";

export const dynamic = "force-dynamic";

/** Exporta clientes a CSV (abre en Excel). Requiere `customers.export`. */
export async function GET() {
  const ctx = await getRequestContext();
  if (!ctx) return NextResponse.json({ ok: false, error: "Tu sesión expiró." }, { status: 401 });
  try {
    const csv = await exportCustomersCsv(ctx);
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="clientes-${date}.csv"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    throw e;
  }
}
