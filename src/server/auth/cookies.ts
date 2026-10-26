import "server-only";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { SESSION_ABSOLUTE_MS, SESSION_COOKIE } from "./session";

const secure = process.env.NODE_ENV === "production";

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_ABSOLUTE_MS / 1000),
  });
}

export async function clearSessionCookie() {
  (await cookies()).set(SESSION_COOKIE, "", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0 });
}

/** Identificador estable del dispositivo (para bitácora y sincronización offline). */
export async function ensureDeviceId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get("sc_device")?.value;
  if (existing) return existing;
  const id = randomBytes(12).toString("base64url");
  jar.set("sc_device", id, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 * 2 });
  return id;
}
