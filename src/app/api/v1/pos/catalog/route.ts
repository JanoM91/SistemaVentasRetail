import { withApi } from "@/server/api";
import { getPosCatalog } from "@/server/modules/pos/catalog";

export const dynamic = "force-dynamic";

export const GET = withApi(async (req, ctx) => getPosCatalog(ctx, req.nextUrl.searchParams.get("branchId")));
