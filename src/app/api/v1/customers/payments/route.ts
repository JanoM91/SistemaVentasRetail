import { withApi } from "@/server/api";
import { getPosCustomer, registerCustomerPayment } from "@/server/modules/customers/service";

export const dynamic = "force-dynamic";

/** Abono de cliente en caja. Idempotente por `id`. */
export const POST = withApi(async (req, ctx) => {
  const r = await registerCustomerPayment(ctx, await req.json());
  const m = r.movement;
  return { id: m.id, folio: m.folio, amount: -m.amount, balanceAfter: m.balanceAfter, createdAt: m.createdAt, duplicate: r.duplicate, customer: await getPosCustomer(ctx, m.customerId) };
});
