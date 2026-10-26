import { and, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/server/db";
import { users, tenants } from "@/server/db/schema";
import {
  hashPassword,
  passwordPolicyErrors,
  verifyPassword,
} from "@/server/auth/password";
import {
  createSession,
  revokeAllUserSessions,
  revokeSession,
  type ClientInfo,
} from "@/server/auth/session";
import { recordAudit } from "@/server/audit";
import { resolveAuthz } from "@/server/authz/resolve";
import { DomainError, ValidationError } from "@/server/errors";
import type { Permission } from "@/server/authz/permissions";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

const GENERIC_LOGIN_ERROR = "Usuario o contraseña incorrectos.";

export type LoginInput = {
  username: string;
  password: string;
  /** Slug del tenant. Opcional: si el usuario es único entre tenants se resuelve solo. */
  tenantSlug?: string | null;
} & ClientInfo;

export type LoginResult = {
  token: string;
  sessionId: string;
  userId: string;
  tenantId: string;
  mustChangePassword: boolean;
};

/**
 * Inicio de sesión. Respuesta genérica para no revelar usuarios; bloqueo
 * temporal tras MAX_FAILED_ATTEMPTS fallos; bitácora de éxito y fallo.
 */
export async function login(input: LoginInput, conn: DbOrTx = db): Promise<LoginResult> {
  const username = input.username.trim().toLowerCase();
  if (!username || !input.password) throw new DomainError("invalid_credentials", GENERIC_LOGIN_ERROR, 401);

  const where = [sql`lower(${users.username}) = ${username}`];
  if (input.tenantSlug) {
    where.push(eq(tenants.slug, input.tenantSlug.trim().toLowerCase()));
  }
  const candidates = await conn
    .select({ user: users, tenantStatus: tenants.status })
    .from(users)
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .where(and(...where))
    .limit(2);

  // Usuario inexistente o ambiguo: comparar contra hash ficticio para igualar tiempos.
  if (candidates.length !== 1) {
    await verifyPassword(input.password, null);
    if (candidates.length > 1) {
      throw new DomainError(
        "ambiguous_user",
        "Ese usuario existe en más de una cuenta. Indica el identificador de tu cuenta.",
        401,
      );
    }
    throw new DomainError("invalid_credentials", GENERIC_LOGIN_ERROR, 401);
  }

  const { user, tenantStatus } = candidates[0];
  const now = new Date();
  if (user.lockedUntil && user.lockedUntil > now) {
    const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000));
    throw new DomainError(
      "locked",
      `Cuenta bloqueada temporalmente por intentos fallidos. Intenta en ${minutes} min.`,
      423,
    );
  }

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok || user.status !== "active" || tenantStatus !== "active") {
    const attempts = user.failedLoginAttempts + 1;
    const lock = attempts >= MAX_FAILED_ATTEMPTS;
    await conn
      .update(users)
      .set({
        failedLoginAttempts: lock ? 0 : attempts,
        lockedUntil: lock ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null,
      })
      .where(eq(users.id, user.id));
    await recordAudit(
      conn,
      { tenantId: user.tenantId, userId: user.id, ip: input.ip, userAgent: input.userAgent, deviceId: input.deviceId },
      {
        action: lock ? "auth.locked" : "auth.login_failed",
        entity: "user",
        entityId: user.id,
        after: { attempts, locked: lock, reason: !ok ? "password" : user.status !== "active" ? "user_disabled" : "tenant_suspended" },
      },
    );
    if (user.status !== "active") {
      throw new DomainError("disabled", "Tu usuario está desactivado. Contacta al administrador.", 403);
    }
    if (tenantStatus !== "active") {
      throw new DomainError("suspended", "La cuenta de tu negocio está suspendida.", 403);
    }
    throw new DomainError("invalid_credentials", GENERIC_LOGIN_ERROR, 401);
  }

  const authz = await resolveAuthz(
    {
      userId: user.id,
      tenantId: user.tenantId,
      isSuperadmin: user.isSuperadmin,
      requestedCompanyId: user.preferences.lastCompanyId,
      requestedBranchId: user.preferences.lastBranchId,
    },
    conn,
  );
  const session = await createSession(conn, {
    tenantId: user.tenantId,
    userId: user.id,
    activeCompanyId: authz.company?.id ?? null,
    activeBranchId: authz.branch?.id ?? null,
    ip: input.ip,
    userAgent: input.userAgent,
    deviceId: input.deviceId,
  });
  await conn
    .update(users)
    .set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now })
    .where(eq(users.id, user.id));
  await recordAudit(
    conn,
    { tenantId: user.tenantId, userId: user.id, sessionId: session.sessionId, companyId: authz.company?.id, branchId: authz.branch?.id, ip: input.ip, userAgent: input.userAgent, deviceId: input.deviceId },
    { action: "auth.login", entity: "user", entityId: user.id },
  );
  return {
    token: session.token,
    sessionId: session.sessionId,
    userId: user.id,
    tenantId: user.tenantId,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function logout(
  input: { sessionId: string; tenantId: string; userId: string } & ClientInfo,
  conn: DbOrTx = db,
) {
  await revokeSession(input.sessionId, conn);
  await recordAudit(
    conn,
    { tenantId: input.tenantId, userId: input.userId, sessionId: input.sessionId, ip: input.ip, userAgent: input.userAgent, deviceId: input.deviceId },
    { action: "auth.logout", entity: "user", entityId: input.userId },
  );
}

export async function changePassword(
  input: {
    userId: string;
    tenantId: string;
    sessionId: string;
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  } & ClientInfo,
  conn: DbOrTx = db,
) {
  const fieldErrors: Record<string, string[]> = {};
  const policy = passwordPolicyErrors(input.newPassword);
  if (policy.length) fieldErrors.newPassword = policy;
  if (input.newPassword !== input.confirmPassword) {
    fieldErrors.confirmPassword = ["Las contraseñas no coinciden."];
  }
  if (Object.keys(fieldErrors).length) throw new ValidationError(fieldErrors);

  const [user] = await conn.select().from(users).where(eq(users.id, input.userId)).limit(1);
  if (!user) throw new DomainError("not_found", "Usuario no encontrado.", 404);
  const ok = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!ok) throw new ValidationError({ currentPassword: ["La contraseña actual no es correcta."] });
  if (input.currentPassword === input.newPassword) {
    throw new ValidationError({ newPassword: ["La nueva contraseña debe ser distinta a la actual."] });
  }

  await conn
    .update(users)
    .set({
      passwordHash: await hashPassword(input.newPassword),
      mustChangePassword: false,
      passwordChangedAt: new Date(),
      updatedAt: new Date(),
      updatedBy: input.userId,
    })
    .where(eq(users.id, input.userId));
  // Revoca todas las sesiones (incluida la actual: la acción vuelve a iniciar sesión).
  await revokeAllUserSessions(input.userId, conn);
  await recordAudit(
    conn,
    { tenantId: input.tenantId, userId: input.userId, sessionId: input.sessionId, ip: input.ip, userAgent: input.userAgent, deviceId: input.deviceId },
    { action: "auth.password_changed", entity: "user", entityId: input.userId },
  );
}

/**
 * Autorización en caliente: verifica credenciales y permiso de un tercero sin
 * crear sesión. Devuelve el id del autorizador. Se usa en descuentos,
 * cancelaciones, devoluciones, etc.
 */
export async function verifyAuthorizer(
  input: {
    tenantId: string;
    companyId: string;
    username: string;
    password: string;
    permission: Permission;
  },
  conn: DbOrTx = db,
): Promise<{ authorizerId: string; authorizerName: string }> {
  const username = input.username.trim().toLowerCase();
  const [user] = await conn
    .select()
    .from(users)
    .where(and(eq(users.tenantId, input.tenantId), sql`lower(${users.username}) = ${username}`))
    .limit(1);
  const ok = await verifyPassword(input.password, user?.passwordHash);
  if (!user || !ok || user.status !== "active") {
    throw new DomainError("invalid_authorizer", "Credenciales del autorizador incorrectas.", 401);
  }
  const authz = await resolveAuthz(
    { userId: user.id, tenantId: input.tenantId, isSuperadmin: user.isSuperadmin, requestedCompanyId: input.companyId },
    conn,
  );
  if (authz.company?.id !== input.companyId || !authz.permissions.has(input.permission)) {
    throw new DomainError(
      "authorizer_forbidden",
      "El usuario autorizador no tiene permiso para esta acción.",
      403,
    );
  }
  return { authorizerId: user.id, authorizerName: user.fullName };
}
