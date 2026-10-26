"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { requireActionContext } from "@/server/context";
import { resolveAuthz } from "@/server/authz/resolve";
import { setSessionContext } from "@/server/auth/session";
import { clearSessionCookie } from "@/server/auth/cookies";
import { changePassword, logout } from "@/server/modules/auth/service";
import { toActionError, type ActionResult } from "@/server/errors";

/** Cambia la empresa y/o sucursal activas de la sesión. */
export async function switchContextAction(formData: FormData) {
  const ctx = await requireActionContext();
  const companyId = String(formData.get("companyId") ?? "") || ctx.company?.id || null;
  const branchId = String(formData.get("branchId") ?? "") || null;
  const authz = await resolveAuthz({
    userId: ctx.userId,
    tenantId: ctx.tenantId,
    isSuperadmin: ctx.isSuperadmin,
    requestedCompanyId: companyId,
    requestedBranchId: companyId === ctx.company?.id ? branchId : null,
  });
  await setSessionContext(ctx.sessionId, {
    activeCompanyId: authz.company?.id ?? null,
    activeBranchId: authz.branch?.id ?? null,
  });
  const [u] = await db.select({ preferences: users.preferences }).from(users).where(eq(users.id, ctx.userId));
  await db
    .update(users)
    .set({ preferences: { ...u.preferences, lastCompanyId: authz.company?.id, lastBranchId: authz.branch?.id } })
    .where(eq(users.id, ctx.userId));
  revalidatePath("/", "layout");
  redirect("/");
}

export async function logoutAction() {
  const ctx = await requireActionContext();
  await logout({ sessionId: ctx.sessionId, tenantId: ctx.tenantId, userId: ctx.userId, ...ctx.client });
  await clearSessionCookie();
  redirect("/login");
}

export async function changePasswordAction(_prev: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<unknown>> {
  try {
    const ctx = await requireActionContext();
    await changePassword({
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      sessionId: ctx.sessionId,
      currentPassword: String(formData.get("currentPassword") ?? ""),
      newPassword: String(formData.get("newPassword") ?? ""),
      confirmPassword: String(formData.get("confirmPassword") ?? ""),
      ...ctx.client,
    });
    await clearSessionCookie();
  } catch (err) {
    return toActionError(err);
  }
  redirect("/login?cambio=ok");
}

export async function setThemeAction(theme: "light" | "dark" | "system") {
  const ctx = await requireActionContext();
  const [u] = await db.select({ preferences: users.preferences }).from(users).where(eq(users.id, ctx.userId));
  await db.update(users).set({ preferences: { ...u.preferences, theme } }).where(eq(users.id, ctx.userId));
}
