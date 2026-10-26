import { withApi } from "@/server/api";
import { searchVariants } from "@/server/modules/catalog/service";

export const dynamic = "force-dynamic";

/** Búsqueda de variantes por nombre, SKU o código de barras (selectores). */
export const GET = withApi(async (req, ctx) => {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  return searchVariants(ctx, q, 20);
});
