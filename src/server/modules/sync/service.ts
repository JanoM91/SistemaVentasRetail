import { z } from "zod";
import { db } from "@/server/db";
import { syncEvents } from "@/server/db/schema";
import { DomainError, ValidationError } from "@/server/errors";
import type { ServiceContext } from "@/server/service-context";
import { createSale } from "@/server/modules/sales/service";

export const syncBatchSchema = z.object({
  deviceId: z.string().max(64).optional(),
  sales: z.array(z.unknown()).max(50, "Máximo 50 ventas por lote"),
});

export type SyncItemResult = {
  id: string;
  status: "applied" | "duplicate" | "conflict" | "rejected";
  folio?: string;
  flags?: Array<{ code: string; detail: string }>;
  error?: string;
  code?: string;
};

/**
 * Aplica un lote de ventas hechas sin conexión, en orden. Cada venta va en su
 * propia transacción: una venta rechazada no detiene a las demás. Todo
 * resultado distinto de "applied" queda en sync_events para revisión.
 */
export async function syncSales(ctx: ServiceContext, raw: unknown): Promise<SyncItemResult[]> {
  const parsed = syncBatchSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError({ sales: [parsed.error.issues[0]?.message ?? "Lote inválido"] }, "Lote de sincronización inválido.");
  const results: SyncItemResult[] = [];
  for (const sale of parsed.data.sales) {
    const id = typeof sale === "object" && sale && "id" in sale ? String((sale as { id: unknown }).id) : "desconocido";
    let result: SyncItemResult;
    try {
      const r = await createSale(ctx, sale, { origin: "offline" });
      result =
        r.status === "duplicate"
          ? { id, status: "duplicate", folio: r.sale.folio, flags: r.flags }
          : { id, status: r.flags.length ? "conflict" : "applied", folio: r.sale.folio, flags: r.flags };
    } catch (err) {
      if (!(err instanceof DomainError)) console.error("[sync]", err);
      result = {
        id,
        status: "rejected",
        error: err instanceof DomainError ? err.message : "Error inesperado al registrar la venta.",
        code: err instanceof DomainError ? err.code : "internal",
      };
    }
    results.push(result);
    if (result.status !== "applied") {
      await db.insert(syncEvents).values({
        tenantId: ctx.tenantId,
        companyId: ctx.company?.id ?? null,
        branchId: ctx.branch?.id ?? null,
        userId: ctx.userId,
        deviceId: parsed.data.deviceId ?? ctx.actor.deviceId ?? null,
        entity: "sale",
        entityId: id,
        status: result.status,
        detail: { folio: result.folio, flags: result.flags, error: result.error, code: result.code, payload: result.status === "rejected" ? sale : undefined },
      });
    }
  }
  return results;
}
