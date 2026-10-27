import { withApi } from "@/server/api";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { customerCreditMovements } from "@/server/db/schema";
import { createSale } from "@/server/modules/sales/service";

export const dynamic = "force-dynamic";

/** Venta en línea desde el POS. Idempotente: reenviar el mismo id devuelve la venta existente. */
export const POST = withApi(async (req, ctx) => {
  const body = await req.json();
  const r = await createSale(ctx, body, { origin: "online" });
  const [charge] = r.sale.customerId
    ? await db.select().from(customerCreditMovements).where(and(eq(customerCreditMovements.saleId, r.sale.id), eq(customerCreditMovements.kind, "charge"))).limit(1)
    : [];
  return {
    status: r.status,
    id: r.sale.id,
    folio: r.sale.folio,
    total: r.sale.total,
    soldAt: r.sale.soldAt,
    flags: r.flags,
    credit: charge ? { amount: charge.amount, balance: charge.balanceAfter, dueDate: charge.dueDate } : null,
  };
});
