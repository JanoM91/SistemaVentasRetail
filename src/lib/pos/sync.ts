/**
 * Motor de sincronización del POS (navegador). Envía las ventas pendientes en
 * lotes ordenados al endpoint /api/v1/sync. Es seguro reintentar: el servidor
 * reconoce cada venta por su UUID y nunca la duplica.
 */
import { localDb, type OutboxSale } from "./local-db";

export const CLIENT_HEADERS = { "Content-Type": "application/json", "x-sc-client": "pos" };

export type SyncReport = { sent: number; applied: number; conflicts: number; rejected: number; remaining: number; error?: string; unauthenticated?: boolean };

type ItemResult = { id: string; status: "applied" | "duplicate" | "conflict" | "rejected"; folio?: string; flags?: Array<{ code: string; detail: string }>; error?: string };

let running: Promise<SyncReport> | null = null;

/** Envía las ventas pendientes del usuario actual. Llamadas concurrentes comparten la misma ejecución. */
export function syncOutbox(userId: string, opts: { batchSize?: number; timeoutMs?: number } = {}): Promise<SyncReport> {
  if (running) return running;
  running = doSync(userId, opts).finally(() => {
    running = null;
  });
  return running;
}

async function doSync(userId: string, { batchSize = 20, timeoutMs = 15000 }: { batchSize?: number; timeoutMs?: number }): Promise<SyncReport> {
  const report: SyncReport = { sent: 0, applied: 0, conflicts: 0, rejected: 0, remaining: 0 };
  const all = await localDb.outboxAll();
  const pending = all
    .filter((o) => o.status === "pending" && o.userId === userId)
    .sort((a, b) => ((a.payload.clientSequence as number) ?? 0) - ((b.payload.clientSequence as number) ?? 0));
  const deviceId = await localDb.getKv<string>("deviceId");

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    let results: ItemResult[];
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch("/api/v1/sync", {
        method: "POST",
        headers: CLIENT_HEADERS,
        body: JSON.stringify({ deviceId, sales: batch.map((b) => b.payload) }),
        signal: ctrl.signal,
        credentials: "same-origin",
      });
      clearTimeout(timer);
      if (res.status === 401) {
        report.unauthenticated = true;
        report.error = "Tu sesión expiró. Inicia sesión para sincronizar.";
        break;
      }
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Error del servidor");
      results = json.data;
    } catch (e) {
      // Sin red o servidor caído: se reintenta después; las ventas siguen seguras en el dispositivo.
      for (const b of batch) await localDb.outboxPut({ ...b, attempts: b.attempts + 1, lastError: e instanceof Error ? e.message : String(e) });
      report.error = navigator.onLine ? "No se pudo contactar al servidor." : "Sin conexión.";
      break;
    }
    report.sent += batch.length;
    for (const r of results) {
      const item = batch.find((b) => b.id === r.id);
      if (!item) continue;
      if (r.status === "rejected") {
        report.rejected++;
        // Nunca se descarta en silencio: queda marcada para que un gerente la revise.
        await localDb.outboxPut({ ...item, status: "rejected", attempts: item.attempts + 1, lastError: r.error ?? "Rechazada" });
        await updateRecent(item, null, "rejected", r.error ?? null);
        continue;
      }
      if (r.status === "conflict") report.conflicts++;
      else report.applied++;
      await localDb.outboxDelete(item.id);
      await updateRecent(item, r.folio ?? null, r.status === "conflict" ? "conflict" : "synced", r.flags?.map((f) => f.detail).join(" · ") ?? null);
    }
  }
  report.remaining = (await localDb.outboxAll()).filter((o) => o.status === "pending" && o.userId === userId).length;
  await localDb.setKv("lastSyncAt", new Date().toISOString());
  return report;
}

async function updateRecent(item: OutboxSale, folio: string | null, status: "synced" | "conflict" | "rejected", message: string | null) {
  const recent = (await localDb.recentAll()).find((r) => r.id === item.id);
  if (recent) await localDb.recentPut({ ...recent, folio: folio ?? recent.folio, status, message });
}

export async function outboxCounts(userId: string) {
  const all = await localDb.outboxAll();
  return {
    pending: all.filter((o) => o.status === "pending" && o.userId === userId).length,
    rejected: all.filter((o) => o.status === "rejected" && o.userId === userId).length,
    otherUsers: all.filter((o) => o.status === "pending" && o.userId !== userId).length,
  };
}
