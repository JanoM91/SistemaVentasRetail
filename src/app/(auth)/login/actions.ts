"use server";

import { redirect } from "next/navigation";
import { login } from "@/server/modules/auth/service";
import { ensureDeviceId, setSessionCookie } from "@/server/auth/cookies";
import { getClientInfo } from "@/server/context";
import { toActionError, type ActionResult } from "@/server/errors";

export async function loginAction(_prev: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<unknown>> {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const tenantSlug = String(formData.get("tenantSlug") ?? "") || null;
  const next = String(formData.get("next") ?? "") || "/";
  let mustChangePassword = false;
  try {
    const client = await getClientInfo();
    const deviceId = client.deviceId ?? (await ensureDeviceId());
    const result = await login({ username, password, tenantSlug, ...client, deviceId });
    await setSessionCookie(result.token);
    mustChangePassword = result.mustChangePassword;
  } catch (err) {
    return toActionError(err);
  }
  redirect(mustChangePassword ? "/cambiar-contrasena" : next.startsWith("/") ? next : "/");
}
