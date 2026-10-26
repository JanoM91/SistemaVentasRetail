import { withApi } from "@/server/api";
import { listRegistersWithStatus } from "@/server/modules/cash/service";

export const dynamic = "force-dynamic";

/** Cajas de la sucursal con su turno abierto (el POS lo consulta al reconectar). */
export const GET = withApi(async (req, ctx) => {
  const rows = await listRegistersWithStatus(ctx, req.nextUrl.searchParams.get("branchId") ?? undefined);
  return rows.map(({ register, session, openedByName }) => ({
    id: register.id,
    code: register.code,
    name: register.name,
    session: session ? { id: session.id, openedAt: session.openedAt, openedByName } : null,
  }));
});
