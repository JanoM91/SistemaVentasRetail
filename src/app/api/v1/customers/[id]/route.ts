import { withApi } from "@/server/api";
import { getPosCustomer } from "@/server/modules/customers/service";

export const dynamic = "force-dynamic";

/** Datos del cliente para el POS (saldo, crédito disponible y vencido al momento). */
export const GET = withApi<{ id: string }>(async (_req, ctx, params) => getPosCustomer(ctx, params.id));
