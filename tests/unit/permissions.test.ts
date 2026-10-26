import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  isPermission,
  moduleForArea,
  NON_PLATFORM_PERMISSIONS,
  PERMISSIONS,
  permissionArea,
} from "@/server/authz/permissions";
import { SYSTEM_ROLE_BY_KEY, SYSTEM_ROLES } from "@/server/authz/system-roles";
import { effectivePermissions } from "@/server/authz/resolve";
import { permissionsNotDelegable, hasPermission, requirePermission } from "@/server/authz/guard";
import { ForbiddenError } from "@/server/errors";
import type { ModuleKey } from "@/server/db/schema";

describe("catálogo de permisos", () => {
  it("no tiene códigos duplicados", () => {
    const codes = PERMISSIONS.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("todo código tiene formato area.accion", () => {
    for (const p of PERMISSIONS) expect(p.code).toMatch(/^[a-z]+\.[a-z_.]+$/);
  });

  it("isPermission reconoce solo códigos válidos", () => {
    expect(isPermission("pos.sell")).toBe(true);
    expect(isPermission("pos.hack")).toBe(false);
  });

  it("mapea áreas a módulos activables", () => {
    expect(moduleForArea("users")).toBeNull();
    expect(moduleForArea("cash")).toBe("pos");
    expect(moduleForArea("catalog")).toBe("catalog");
  });
});

describe("roles del sistema", () => {
  it("todos los roles usan permisos existentes", () => {
    for (const role of SYSTEM_ROLES) {
      for (const p of role.permissions) expect(isPermission(p)).toBe(true);
    }
  });

  it("solo el superadministrador tiene permisos de plataforma", () => {
    expect(SYSTEM_ROLE_BY_KEY.superadmin.permissions).toContain("platform.tenants.manage");
    for (const key of ["owner", "manager", "cashier"] as const) {
      expect(SYSTEM_ROLE_BY_KEY[key].permissions.some((p) => permissionArea(p) === "platform")).toBe(false);
    }
  });

  it("el dueño tiene todo menos plataforma", () => {
    expect([...SYSTEM_ROLE_BY_KEY.owner.permissions].sort()).toEqual([...NON_PLATFORM_PERMISSIONS].sort());
  });

  it("el cajero no ve costos, utilidades ni configuración", () => {
    const c = SYSTEM_ROLE_BY_KEY.cashier.permissions;
    expect(c).not.toContain("catalog.view_cost");
    expect(c).not.toContain("reports.view_profit");
    expect(c).not.toContain("settings.manage");
    expect(c).not.toContain("users.manage");
    expect(c).toContain("pos.sell");
    expect(c).toContain("cash.close");
  });

  it("el gerente es un subconjunto estricto del dueño", () => {
    const owner = new Set(SYSTEM_ROLE_BY_KEY.owner.permissions);
    const manager = SYSTEM_ROLE_BY_KEY.manager.permissions;
    for (const p of manager) expect(owner.has(p)).toBe(true);
    expect(manager.length).toBeLessThan(owner.size);
    expect(manager).not.toContain("roles.manage");
  });
});

describe("permisos efectivos", () => {
  it("filtra permisos de módulos apagados", () => {
    const enabled = new Set<ModuleKey>(["catalog"]);
    const eff = effectivePermissions(["catalog.view", "pos.sell", "cash.open", "users.manage"], enabled, false);
    expect(eff.has("catalog.view")).toBe(true);
    expect(eff.has("users.manage")).toBe(true); // núcleo: no depende de módulo
    expect(eff.has("pos.sell")).toBe(false);
    expect(eff.has("cash.open")).toBe(false); // cash depende de pos
  });

  it("añade plataforma solo a superadministradores", () => {
    const none = effectivePermissions([], new Set(), false);
    expect(none.has("platform.tenants.manage")).toBe(false);
    const admin = effectivePermissions([], new Set(), true);
    expect(admin.has("platform.tenants.manage")).toBe(true);
    expect(admin.size).toBe(ALL_PERMISSIONS.filter((p) => permissionArea(p) === "platform").length);
  });
});

describe("guardas", () => {
  const ctx = { permissions: new Set(SYSTEM_ROLE_BY_KEY.cashier.permissions) };
  it("requirePermission lanza ForbiddenError", () => {
    expect(() => requirePermission(ctx, "users.manage")).toThrow(ForbiddenError);
    expect(() => requirePermission(ctx, "pos.sell")).not.toThrow();
    expect(hasPermission(ctx, "pos.sell")).toBe(true);
  });

  it("no se pueden delegar permisos que no se tienen", () => {
    expect(permissionsNotDelegable(ctx, ["pos.sell", "users.manage"])).toEqual(["users.manage"]);
  });
});
