import { eq } from "drizzle-orm";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { saleReturnLines } from "@/server/db/schema";
import { createReturn } from "@/server/modules/returns/service";

export const dynamic = "force-dynamic";

/** Registra una devolución desde el POS. Idempotente por `id`. */
export const POST = withApi(async (req, ctx) => {
  const r = await createReturn(ctx, await req.json());
  const lines = await db.select().from(saleReturnLines).where(eq(saleReturnLines.returnId, r.ret.id));
  return {
    id: r.ret.id,
    folio: r.ret.folio,
    total: r.ret.total,
    refundMethod: r.ret.refundMethod,
    storeCreditBalance: r.ret.storeCreditBalance,
    createdAt: r.ret.createdAt,
    duplicate: r.duplicate,
    lines: lines.map((l) => ({ description: l.description, sku: l.sku, quantity: Number(l.quantity), total: l.lineTotal, restock: l.restock })),
  };
});
