import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { loadSession, SESSION_COOKIE, type ClientInfo } from "@/server/auth/session";
import { resolveAuthz, type AuthzContext } from "@/server/authz/resolve";
import type { AuditActor } from "@/server/audit";
import { UnauthenticatedError } from "@/server/errors";
import type { Permission } from "@/server/authz/permissions";

export type RequestContext = AuthzContext & {
  sessionId: string;
  user: {
    id: string;
    username: string;
    fullName: string;
    email: string | null;
    isSuperadmin: boolean;
    mustChangePassword: boolean;
    preferences: { theme?: "light" | "dark" | "system" };
  };
  client: ClientInfo;
  /** Datos listos para la bitácora. */
  actor: AuditActor;
};

export async function getClientInfo(): Promise<ClientInfo> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  return {
    ip: (forwarded ? forwarded.split(",")[0].trim() : h.get("x-real-ip")) ?? null,
    userAgent: h.get("user-agent"),
    deviceId: (await cookies()).get("sc_device")?.value ?? null,
  };
}

/**
 * Contexto de la petición actual (memoizado por petición).
 * Devuelve null si no hay sesión válida.
 */
export const getRequestContext = cache(async (): Promise<RequestContext | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const loaded = await loadSession(token, db);
  if (!loaded) return null;
  const { session, user } = loaded;
  const authz = await resolveAuthz(
    {
      userId: user.id,
      tenantId: user.tenantId,
      isSuperadmin: user.isSuperadmin,
      requestedCompanyId: session.activeCompanyId ?? user.preferences.lastCompanyId,
      requestedBranchId: session.activeBranchId ?? user.preferences.lastBranchId,
    },
    db,
  );
  const client = await getClientInfo();
  return {
    ...authz,
    sessionId: session.id,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      isSuperadmin: user.isSuperadmin,
      mustChangePassword: user.mustChangePassword,
      preferences: { theme: user.preferences.theme },
    },
    client,
    actor: {
      tenantId: user.tenantId,
      userId: user.id,
      sessionId: session.id,
      companyId: authz.company?.id ?? null,
      branchId: authz.branch?.id ?? null,
      ip: client.ip,
      userAgent: client.userAgent,
      deviceId: client.deviceId,
    },
  };
});

/** Para páginas: redirige al login si no hay sesión. */
export async function requireContext(): Promise<RequestContext> {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/** Para acciones de servidor: lanza error tipado si no hay sesión. */
export async function requireActionContext(): Promise<RequestContext> {
  const ctx = await getRequestContext();
  if (!ctx) throw new UnauthenticatedError();
  return ctx;
}

/** Para páginas: exige un permiso o redirige a la pantalla "sin permiso". */
export async function requirePagePermission(permission: Permission): Promise<RequestContext> {
  const ctx = await requireContext();
  if (!ctx.permissions.has(permission)) redirect(`/sin-permiso?p=${encodeURIComponent(permission)}`);
  return ctx;
}
