import { withApi } from "@/server/api";
import { getStoreCredit } from "@/server/modules/returns/service";

export const dynamic = "force-dynamic";

/** Saldo de un vale de devolución por folio. */
export const GET = withApi(async (req, ctx) => {
  const v = await getStoreCredit(ctx, req.nextUrl.searchParams.get("folio") ?? "");
  return { folio: v.folio, balance: v.balance, total: v.total, customerName: v.customerName };
});
