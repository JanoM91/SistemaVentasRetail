/**
 * Almacenamiento local del punto de venta (IndexedDB). Solo se usa en el
 * navegador. Guarda el catálogo de la sucursal, la cola de ventas pendientes
 * de sincronizar, el historial reciente y las ventas suspendidas.
 */
import type { PosCatalog } from "@/server/modules/pos/catalog";

const DB_NAME = "sc-pos";
const DB_VERSION = 1;

export type OutboxSale = {
  id: string;
  /** Usuario que hizo la venta: solo él la sincroniza (el servidor atribuye la venta a la sesión). */
  userId: string;
  tenantId: string;
  createdAt: string;
  attempts: number;
  lastError?: string | null;
  status: "pending" | "rejected";
  payload: Record<string, unknown>;
  /** Datos para reimprimir el ticket mientras no hay folio. */
  ticket: unknown;
};

export type RecentSale = {
  id: string;
  folio: string | null;
  total: number;
  soldAt: string;
  status: "synced" | "pending" | "conflict" | "rejected";
  message?: string | null;
  ticket: unknown;
};

export type HeldCart = { id: string; label: string; createdAt: string; registerId: string; lines: unknown[]; customer?: unknown; customerName?: string | null };

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("catalog")) db.createObjectStore("catalog", { keyPath: "branchId" });
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "id" });
      if (!db.objectStoreNames.contains("recent")) db.createObjectStore("recent", { keyPath: "id" });
      if (!db.objectStoreNames.contains("held")) db.createObjectStore("held", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        const r = fn(s);
        t.oncomplete = () => resolve(r ? (r.result as T) : (undefined as T));
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const localDb = {
  getKv: <T>(key: string) => tx<T | undefined>("kv", "readonly", (s) => s.get(key) as IDBRequest<T | undefined>),
  setKv: (key: string, value: unknown) => tx("kv", "readwrite", (s) => void s.put(value, key)),

  getCatalog: (branchId: string) => tx<PosCatalog | undefined>("catalog", "readonly", (s) => s.get(branchId) as IDBRequest<PosCatalog | undefined>),
  saveCatalog: (c: PosCatalog) => tx("catalog", "readwrite", (s) => void s.put(c)),

  outboxAll: () => tx<OutboxSale[]>("outbox", "readonly", (s) => s.getAll() as IDBRequest<OutboxSale[]>),
  outboxPut: (o: OutboxSale) => tx("outbox", "readwrite", (s) => void s.put(o)),
  outboxDelete: (id: string) => tx("outbox", "readwrite", (s) => void s.delete(id)),

  recentAll: () => tx<RecentSale[]>("recent", "readonly", (s) => s.getAll() as IDBRequest<RecentSale[]>),
  recentPut: (r: RecentSale) => tx("recent", "readwrite", (s) => void s.put(r)),
  async recentTrim(max = 50) {
    const all = (await this.recentAll()).sort((a, b) => b.soldAt.localeCompare(a.soldAt));
    for (const r of all.slice(max)) await tx("recent", "readwrite", (s) => void s.delete(r.id));
  },

  heldAll: () => tx<HeldCart[]>("held", "readonly", (s) => s.getAll() as IDBRequest<HeldCart[]>),
  heldPut: (h: HeldCart) => tx("held", "readwrite", (s) => void s.put(h)),
  heldDelete: (id: string) => tx("held", "readwrite", (s) => void s.delete(id)),
};

/** UUID v7: ordenable por tiempo, generado en el dispositivo (idempotencia offline). */
export function uuidv7(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const ts = BigInt(Date.now());
  for (let i = 0; i < 6; i++) bytes[i] = Number((ts >> BigInt(8 * (5 - i))) & BigInt(0xff));
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Identificador estable del dispositivo y secuencia local de ventas. */
export async function nextClientSequence(): Promise<{ deviceId: string; sequence: number }> {
  let deviceId = await localDb.getKv<string>("deviceId");
  if (!deviceId) {
    deviceId = uuidv7();
    await localDb.setKv("deviceId", deviceId);
  }
  const seq = ((await localDb.getKv<number>("sequence")) ?? 0) + 1;
  await localDb.setKv("sequence", seq);
  return { deviceId, sequence: seq };
}
