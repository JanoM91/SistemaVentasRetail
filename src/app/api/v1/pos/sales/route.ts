import { withApi } from "@/server/api";
import { createSale } from "@/server/modules/sales/service";

export const dynamic = "force-dynamic";

/** Venta en línea desde el POS. Idempotente: reenviar el mismo id devuelve la venta existente. */
export const POST = withApi(async (req, ctx) => {
  const body = await req.json();
  const r = await createSale(ctx, body, { origin: "online" });
  return { status: r.status, id: r.sale.id, folio: r.sale.folio, total: r.sale.total, soldAt: r.sale.soldAt, flags: r.flags };
});
