import { withApi } from "@/server/api";
import { validateCoupon } from "@/server/modules/promotions/service";

export const dynamic = "force-dynamic";

/** Valida un cupón en el POS (requiere conexión). */
export const GET = withApi(async (req, ctx) => validateCoupon(ctx, req.nextUrl.searchParams.get("code") ?? ""));
