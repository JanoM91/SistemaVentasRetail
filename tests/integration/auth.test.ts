import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { auditLog, sessions, users } from "@/server/db/schema";
import { loadSession, revokeSession } from "@/server/auth/session";
import { changePassword, login, logout, MAX_FAILED_ATTEMPTS, verifyAuthorizer } from "@/server/modules/auth/service";
import { createTenantFixture, PASSWORD, resetDatabase, type Fixture } from "../helpers";

const client = { ip: "10.0.0.1", userAgent: "vitest", deviceId: "dev-1" };

describe("autenticación", () => {
  let f: Fixture;
  beforeEach(async () => {
    await resetDatabase();
    f = await createTenantFixture();
  });

  it("inicia sesión con usuario y contraseña y guarda la sesión como hash", async () => {
    const r = await login({ username: f.owner.username, password: PASSWORD, ...client });
    expect(r.userId).toBe(f.owner.id);
    const [s] = await db.select().from(sessions).where(eq(sessions.userId, f.owner.id));
    expect(s.tokenHash).not.toBe(r.token);
    expect(s.tokenHash).toHaveLength(64);
    expect(s.ip).toBe("10.0.0.1");
    expect(s.activeCompanyId).toBe(f.company.id);
    expect(s.activeBranchId).toBe(f.branch.id);
    const loaded = await loadSession(r.token);
    expect(loaded?.user.id).toBe(f.owner.id);
    const logs = await db.select().from(auditLog).where(eq(auditLog.action, "auth.login"));
    expect(logs).toHaveLength(1);
    expect(logs[0].deviceId).toBe("dev-1");
  });

  it("no distingue entre usuario inexistente y contraseña incorrecta", async () => {
    const a = await login({ username: "nadie", password: "x", ...client }).catch((e) => e.message);
    const b = await login({ username: f.owner.username, password: "mala", ...client }).catch((e) => e.message);
    expect(a).toBe(b);
    expect(a).toBe("Usuario o contraseña incorrectos.");
  });

  it("bloquea la cuenta tras intentos fallidos y la libera con el tiempo", async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      await login({ username: f.owner.username, password: "mala", ...client }).catch(() => {});
    }
    await expect(login({ username: f.owner.username, password: PASSWORD, ...client })).rejects.toThrow(/bloqueada/);
    const locked = await db.select().from(auditLog).where(eq(auditLog.action, "auth.locked"));
    expect(locked).toHaveLength(1);
    // Simula que pasó el tiempo de bloqueo.
    await db.update(users).set({ lockedUntil: new Date(Date.now() - 1000) }).where(eq(users.id, f.owner.id));
    const r = await login({ username: f.owner.username, password: PASSWORD, ...client });
    expect(r.userId).toBe(f.owner.id);
  });

  it("rechaza usuarios desactivados", async () => {
    await db.update(users).set({ status: "disabled" }).where(eq(users.id, f.cashier.id));
    await expect(login({ username: f.cashier.username, password: PASSWORD, ...client })).rejects.toThrow(/desactivado/);
  });

  it("cerrar sesión la revoca", async () => {
    const r = await login({ username: f.owner.username, password: PASSWORD, ...client });
    await logout({ sessionId: r.sessionId, tenantId: r.tenantId, userId: r.userId, ...client });
    expect(await loadSession(r.token)).toBeNull();
  });

  it("una sesión expirada o revocada no carga", async () => {
    const r = await login({ username: f.owner.username, password: PASSWORD, ...client });
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(sessions.id, r.sessionId));
    expect(await loadSession(r.token)).toBeNull();
    const r2 = await login({ username: f.owner.username, password: PASSWORD, ...client });
    await revokeSession(r2.sessionId);
    expect(await loadSession(r2.token)).toBeNull();
  });

  it("cambiar contraseña valida política y revoca todas las sesiones", async () => {
    const r1 = await login({ username: f.owner.username, password: PASSWORD, ...client });
    const r2 = await login({ username: f.owner.username, password: PASSWORD, ...client });
    const base = { userId: f.owner.id, tenantId: f.tenant.id, sessionId: r1.sessionId, ...client };
    await expect(
      changePassword({ ...base, currentPassword: PASSWORD, newPassword: "corta", confirmPassword: "corta" }),
    ).rejects.toMatchObject({ fieldErrors: { newPassword: expect.any(Array) } });
    await expect(
      changePassword({ ...base, currentPassword: "mala", newPassword: "Nueva12345", confirmPassword: "Nueva12345" }),
    ).rejects.toMatchObject({ fieldErrors: { currentPassword: expect.any(Array) } });
    await changePassword({ ...base, currentPassword: PASSWORD, newPassword: "Nueva12345", confirmPassword: "Nueva12345" });
    expect(await loadSession(r1.token)).toBeNull();
    expect(await loadSession(r2.token)).toBeNull();
    const r3 = await login({ username: f.owner.username, password: "Nueva12345", ...client });
    expect(r3.userId).toBe(f.owner.id);
  });

  it("autorización en caliente verifica credenciales y permiso del tercero", async () => {
    await expect(
      verifyAuthorizer({ tenantId: f.tenant.id, companyId: f.company.id, username: f.cashier.username, password: PASSWORD, permission: "pos.discount" }),
    ).rejects.toThrow(/no tiene permiso/);
    await expect(
      verifyAuthorizer({ tenantId: f.tenant.id, companyId: f.company.id, username: f.manager.username, password: "mala", permission: "pos.discount" }),
    ).rejects.toThrow(/incorrectas/);
    const ok = await verifyAuthorizer({ tenantId: f.tenant.id, companyId: f.company.id, username: f.manager.username, password: PASSWORD, permission: "pos.discount" });
    expect(ok.authorizerId).toBe(f.manager.id);
    // No crea sesión.
    expect(await db.select().from(sessions).where(eq(sessions.userId, f.manager.id))).toHaveLength(0);
  });
});
