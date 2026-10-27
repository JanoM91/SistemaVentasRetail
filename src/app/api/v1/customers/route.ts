import { withApi } from "@/server/api";
import { createCustomer, getPosCustomer, searchCustomersForPos } from "@/server/modules/customers/service";

export const dynamic = "force-dynamic";

/** Búsqueda de clientes (POS): nombre, teléfono, correo, RFC o clave. Incluye crédito disponible. */
export const GET = withApi(async (req, ctx) => searchCustomersForPos(ctx, req.nextUrl.searchParams.get("q") ?? ""));

/** Alta rápida desde el POS (nombre y teléfono). */
export const POST = withApi(async (req, ctx) => {
  const body = await req.json();
  const c = await createCustomer(ctx, body, { allowDuplicate: body?.allowDuplicate === true });
  return getPosCustomer(ctx, c.id);
});
