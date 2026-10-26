import { withApi } from "@/server/api";
import { syncSales } from "@/server/modules/sync/service";

export const dynamic = "force-dynamic";

/** Sincronización de ventas hechas sin conexión (lotes ordenados, idempotente). */
export const POST = withApi(async (req, ctx) => syncSales(ctx, await req.json()));
