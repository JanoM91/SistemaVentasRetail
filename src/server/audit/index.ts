import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { db, type DbOrTx } from "@/server/db";
import { auditLog, users } from "@/server/db/schema";

export type AuditActor = {
  tenantId: string;
  userId?: string | null;
  sessionId?: string | null;
  companyId?: string | null;
  branchId?: string | null;
  authorizedByUserId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  deviceId?: string | null;
};

export type AuditEntry = {
  action: string;
  entity: string;
  entityId?: string | null;
  reason?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** Permite sobreescribir empresa/sucursal cuando la acción afecta otra. */
  companyId?: string | null;
  branchId?: string | null;
};

const REDACTED_KEYS = new Set(["passwordHash", "password", "tokenHash", "token"]);

/** Quita secretos de los datos antes de guardarlos. */
export function redact<T extends Record<string, unknown> | null | undefined>(data: T): T {
  if (!data) return data;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = REDACTED_KEYS.has(k) ? "[oculto]" : v;
  }
  return out as T;
}

/** Escribe en la bitácora. Debe llamarse dentro de la misma transacción que el cambio. */
export async function recordAudit(conn: DbOrTx, actor: AuditActor, entry: AuditEntry) {
  await conn.insert(auditLog).values({
    tenantId: actor.tenantId,
    companyId: entry.companyId ?? actor.companyId ?? null,
    branchId: entry.branchId ?? actor.branchId ?? null,
    userId: actor.userId ?? null,
    authorizedByUserId: actor.authorizedByUserId ?? null,
    sessionId: actor.sessionId ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    reason: entry.reason ?? null,
    before: redact(entry.before ?? null),
    after: redact(entry.after ?? null),
    ip: actor.ip ?? null,
    userAgent: actor.userAgent?.slice(0, 512) ?? null,
    deviceId: actor.deviceId ?? null,
  });
}

export type AuditFilter = {
  tenantId: string;
  companyId?: string | null;
  branchIds?: string[] | null;
  userId?: string | null;
  action?: string | null;
  entity?: string | null;
  from?: Date | null;
  to?: Date | null;
  limit?: number;
  offset?: number;
};

export async function queryAudit(filter: AuditFilter, conn: DbOrTx = db) {
  const where: SQL[] = [eq(auditLog.tenantId, filter.tenantId)];
  if (filter.companyId) where.push(eq(auditLog.companyId, filter.companyId));
  if (filter.userId) where.push(eq(auditLog.userId, filter.userId));
  if (filter.action) where.push(eq(auditLog.action, filter.action));
  if (filter.entity) where.push(eq(auditLog.entity, filter.entity));
  if (filter.from) where.push(gte(auditLog.createdAt, filter.from));
  if (filter.to) where.push(lte(auditLog.createdAt, filter.to));
  const limit = Math.min(filter.limit ?? 50, 200);
  const rows = await conn
    .select({
      entry: auditLog,
      userName: users.username,
      userFullName: users.fullName,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(...where))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit + 1)
    .offset(filter.offset ?? 0);
  // Filtro por sucursal en memoria (las entradas sin sucursal siempre se muestran).
  const filtered = filter.branchIds
    ? rows.filter((r) => !r.entry.branchId || filter.branchIds!.includes(r.entry.branchId))
    : rows;
  return {
    items: filtered.slice(0, limit),
    hasMore: rows.length > limit,
  };
}
