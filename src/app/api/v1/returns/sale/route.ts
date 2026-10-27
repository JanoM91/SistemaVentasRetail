import { withApi } from "@/server/api";
import { getReturnableSale } from "@/server/modules/returns/service";

export const dynamic = "force-dynamic";

/** Venta por folio con lo que aún se puede devolver. */
export const GET = withApi(async (req, ctx) => getReturnableSale(ctx, req.nextUrl.searchParams.get("folio") ?? ""));
