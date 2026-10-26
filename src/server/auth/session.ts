import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { db, type DbOrTx } from "@/server/db";
import { sessions, users } from "@/server/db/schema";

export const SESSION_COOKIE = "sc_session";
/** Expiración por inactividad (ms). */
export const SESSION_IDLE_MS = Number(process.env.SESSION_IDLE_HOURS ?? 12) * 3600_000;
/** Expiración absoluta (ms). */
export const SESSION_ABSOLUTE_MS = Number(process.env.SESSION_MAX_DAYS ?? 30) * 86_400_000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type ClientInfo = {
  ip?: string | null;
  userAgent?: string | null;
  deviceId?: string | null;
};

export async function createSession(
  conn: DbOrTx,
  input: {
    tenantId: string;
    userId: string;
    activeCompanyId?: string | null;
    activeBranchId?: string | null;
  } & ClientInfo,
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_IDLE_MS);
  const [row] = await conn
    .insert(sessions)
    .values({
      tenantId: input.tenantId,
      userId: input.userId,
      tokenHash: hashToken(token),
      expiresAt,
      absoluteExpiresAt: new Date(now + SESSION_ABSOLUTE_MS),
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 512) ?? null,
      deviceId: input.deviceId ?? null,
      activeCompanyId: input.activeCompanyId ?? null,
      activeBranchId: input.activeBranchId ?? null,
    })
    .returning({ id: sessions.id });
  return { token, sessionId: row.id, expiresAt };
}

export type SessionWithUser = {
  session: typeof sessions.$inferSelect;
  user: typeof users.$inferSelect;
};

/**
 * Carga la sesión válida (no revocada, no expirada) y su usuario activo.
 * Renueva la expiración deslizante como máximo una vez cada 5 minutos.
 */
export async function loadSession(
  token: string | undefined | null,
  conn: DbOrTx = db,
): Promise<SessionWithUser | null> {
  if (!token) return null;
  const now = new Date();
  const [row] = await conn
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        gt(sessions.absoluteExpiresAt, now),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  if (!row) return null;

  if (now.getTime() - row.session.lastSeenAt.getTime() > 5 * 60_000) {
    const newExpiry = new Date(
      Math.min(now.getTime() + SESSION_IDLE_MS, row.session.absoluteExpiresAt.getTime()),
    );
    await conn
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt: newExpiry })
      .where(eq(sessions.id, row.session.id));
    row.session.lastSeenAt = now;
    row.session.expiresAt = newExpiry;
  }
  return row;
}

export async function revokeSession(sessionId: string, conn: DbOrTx = db) {
  await conn
    .update(sessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

export async function revokeAllUserSessions(userId: string, conn: DbOrTx = db) {
  await conn
    .update(sessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export async function setSessionContext(
  sessionId: string,
  ctx: { activeCompanyId: string | null; activeBranchId: string | null },
  conn: DbOrTx = db,
) {
  await conn.update(sessions).set(ctx).where(eq(sessions.id, sessionId));
}
