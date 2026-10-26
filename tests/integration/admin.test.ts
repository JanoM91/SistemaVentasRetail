import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { auditLog, branches, cashRegisters, companyModules, sessions, warehouses } from "@/server/db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createTenant, getTenantDetail, listTenants, resetOwnerPassword, setTenantStatus } from "@/server/modules/platform/service";
import { createCompany, getCompany, listCompanies, listCompanyModules, setCompanyModules, updateCompany, updateCompanySettings } from "@/server/modules/companies/service";
import { createBranch, createCashRegister, createWarehouse, getBranch, listBranches, listWarehouses, setBranchActive, updateWarehouse } from "@/server/modules/branches/service";
import { createRole, listAssignableRoles, listRoles, updateRole } from "@/server/modules/roles/service";
import { createUser, listUsers, resetUserPassword, setUserAccess, setUserActive } from "@/server/modules/users/service";
import { login } from "@/server/modules/auth/service";
import { queryAudit } from "@/server/audit";
import { contextFor, createPlatformFixture, createTenantFixture, PASSWORD, resetDatabase, systemRoleId, type Fixture } from "../helpers";

describe("plataforma", () => {
  beforeEach(resetDatabase);

  it("AC-01: el superadministrador crea un tenant completo con dueño", async () => {
    const { admin } = await createPlatformFixture();
    const ctx = await contextFor(admin);
    const r = await createTenant(ctx, {
      name: "Ferretería López",
      slug: "ferre-lopez",
      companyTradeName: "Ferretería López",
      ownerFullName: "Luis López",
      ownerUsername: "luis",
      ownerEmail: "luis@example.com",
    });
    expect(r.temporaryPassword).toBeTruthy();
    expect(r.owner.mustChangePassword).toBe(true);
    const detail = await getTenantDetail(ctx, r.tenant.id);
    expect(detail.companies).toHaveLength(1);
    expect(detail.owners.map((o) => o.username)).toEqual(["luis"]);
    expect(await db.select().from(branches).where(eq(branches.companyId, r.company.id))).toHaveLength(1);
    expect(await db.select().from(warehouses).where(eq(warehouses.companyId, r.company.id))).toHaveLength(1);
    expect(await db.select().from(cashRegisters).where(eq(cashRegisters.companyId, r.company.id))).toHaveLength(1);
    const mods = await db.select().from(companyModules).where(and(eq(companyModules.companyId, r.company.id), eq(companyModules.enabled, true)));
    expect(mods.map((m) => m.module).sort()).toEqual(["catalog", "customers", "inventory", "pos", "reports"]);
    // El dueño puede iniciar sesión con la temporal.
    const s = await login({ username: "luis", password: r.temporaryPassword!, ip: null, userAgent: null, deviceId: null });
    expect(s.mustChangePassword).toBe(true);
    expect((await listTenants(ctx)).map((t) => t.tenant.slug)).toContain("ferre-lopez");
  });

  it("un dueño no puede crear tenants", async () => {
    const f = await createTenantFixture();
    const ctx = await contextFor(f.owner);
    await expect(createTenant(ctx, {})).rejects.toThrow(ForbiddenError);
  });

  it("suspender un tenant revoca sus sesiones e impide iniciar sesión", async () => {
    const { admin } = await createPlatformFixture();
    const f = await createTenantFixture();
    const s = await login({ username: f.owner.username, password: PASSWORD });
    await setTenantStatus(await contextFor(admin), f.tenant.id, "suspended", "impago");
    const [row] = await db.select().from(sessions).where(eq(sessions.id, s.sessionId));
    expect(row.revokedAt).not.toBeNull();
    await expect(login({ username: f.owner.username, password: PASSWORD })).rejects.toThrow(/suspendida/);
  });

  it("restablecer contraseña del dueño genera temporal y obliga a cambiarla", async () => {
    const { admin } = await createPlatformFixture();
    const f = await createTenantFixture();
    const { temporaryPassword } = await resetOwnerPassword(await contextFor(admin), f.tenant.id, f.owner.id);
    await expect(login({ username: f.owner.username, password: PASSWORD })).rejects.toThrow();
    const s = await login({ username: f.owner.username, password: temporaryPassword });
    expect(s.mustChangePassword).toBe(true);
  });
});

describe("empresas, sucursales, almacenes y cajas", () => {
  let f: Fixture;
  beforeEach(async () => {
    await resetDatabase();
    f = await createTenantFixture();
  });

  it("AC-02: el dueño crea empresa, sucursal, almacén y caja", async () => {
    const ctx = await contextFor(f.owner);
    const company = await createCompany(ctx, {
      code: "emp2",
      legalName: "Segunda SA",
      tradeName: "Segunda",
      currency: "MXN",
      timezone: "America/Mexico_City",
      locale: "es-MX",
      dateFormat: "dd/MM/yyyy",
    });
    expect(company.code).toBe("EMP2");
    expect((await listCompanies(ctx)).map((c) => c.code).sort()).toEqual(["EMP1", "EMP2"]);
    // El creador queda como dueño de la nueva empresa.
    const ctx2 = await contextFor(f.owner, { companyId: company.id });
    expect(ctx2.company?.id).toBe(company.id);
    expect(ctx2.roleKey).toBe("owner");

    const branch = await createBranch(ctx, { code: "sur", name: "Sucursal Sur", email: "" });
    expect(branch.code).toBe("SUR");
    expect(await listWarehouses(ctx, branch.id)).toHaveLength(1);
    const wh = await createWarehouse(ctx, { branchId: branch.id, code: "SUR-BOD", name: "Bodega", isDefault: false, allowsNegativeStock: true });
    expect(wh.isDefault).toBe(false);
    const promoted = await updateWarehouse(ctx, wh.id, { name: "Bodega", isDefault: true, allowsNegativeStock: true });
    expect(promoted.isDefault).toBe(true);
    const defaults = (await listWarehouses(ctx, branch.id)).filter((w) => w.isDefault);
    expect(defaults).toHaveLength(1);
    const reg = await createCashRegister(ctx, { branchId: branch.id, code: "caja2", name: "Caja 2" });
    expect(reg.code).toBe("CAJA2");
  });

  it("valida entradas y devuelve errores por campo", async () => {
    const ctx = await contextFor(f.owner);
    await expect(createBranch(ctx, { code: "con espacio", name: "x" })).rejects.toMatchObject({
      fieldErrors: { code: expect.any(Array), name: expect.any(Array) },
    });
    await expect(createBranch(ctx, { code: "A", name: "Repetida" })).resolves.toBeTruthy();
    await expect(createBranch(ctx, { code: "a", name: "Repetida" })).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("no permite desactivar la única sucursal ni empresa activa", async () => {
    const ctx = await contextFor(f.owner);
    await expect(setBranchActive(ctx, f.branch.id, false)).rejects.toThrow(ConflictError);
    const b2 = await createBranch(ctx, { code: "B2", name: "Dos" });
    await setBranchActive(ctx, b2.id, false, "cierre");
    expect((await listBranches(ctx)).map((b) => b.id)).toEqual([f.branch.id]);
    expect((await listBranches(ctx, { includeInactive: true }))).toHaveLength(2);
  });

  it("el gerente ve y edita solo dentro de su alcance; el cajero no administra", async () => {
    const owner = await contextFor(f.owner);
    const other = await createBranch(owner, { code: "OTRA", name: "Otra" });
    const manager = await contextFor(f.manager);
    expect((await listBranches(manager)).map((b) => b.id)).toEqual([f.branch.id]);
    await expect(getBranch(manager, other.id)).rejects.toThrow(NotFoundError);
    await expect(createBranch(manager, { code: "X", name: "Nueva" })).rejects.toThrow(ForbiddenError);
    const cashier = await contextFor(f.cashier);
    await expect(createCompany(cashier, {})).rejects.toThrow(ForbiddenError);
    await expect(updateCompany(cashier, f.company.id, {})).rejects.toThrow(ForbiddenError);
  });

  it("módulos activables filtran permisos y navegación", async () => {
    const owner = await contextFor(f.owner);
    expect((await listCompanyModules(owner, f.company.id)).find((m) => m.module === "pos")?.enabled).toBe(true);
    await setCompanyModules(owner, f.company.id, ["catalog", "inventory"]);
    const cashier = await contextFor(f.cashier);
    expect(cashier.enabledModules.has("pos")).toBe(false);
    expect(cashier.permissions.has("pos.sell")).toBe(false);
    expect(cashier.permissions.has("cash.open")).toBe(false);
    expect(cashier.permissions.has("catalog.view")).toBe(true);
    const manager = await contextFor(f.manager);
    await expect(setCompanyModules(manager, f.company.id, ["pos"])).rejects.toThrow(ForbiddenError);
  });

  it("configuración de empresa y parámetros quedan auditados", async () => {
    const owner = await contextFor(f.owner);
    await updateCompany(owner, f.company.id, {
      legalName: "Nuevo nombre SA",
      tradeName: "Nuevo",
      currency: "MXN",
      timezone: "America/Cancun",
      locale: "es-MX",
      dateFormat: "yyyy-MM-dd",
    });
    await updateCompanySettings(owner, f.company.id, {
      inventory: { costingMethod: "fifo", allowNegativeStock: true },
      promotions: { allowStacking: true, maxDiscountPercent: 30 },
      pos: { allowSaleWithoutCustomer: false, requireCustomerForCredit: true },
      notifications: { lowStockEmail: "alertas@example.com" },
    });
    const c = await getCompany(owner, f.company.id);
    expect(c.timezone).toBe("America/Cancun");
    expect(c.settings.inventory?.costingMethod).toBe("fifo");
    const { items } = await queryAudit({ tenantId: f.tenant.id, entity: "company" });
    const actions = items.map((i) => i.entry.action);
    expect(actions).toContain("companies.update");
    expect(actions).toContain("settings.update");
    const upd = items.find((i) => i.entry.action === "companies.update")!;
    expect(upd.entry.before).toMatchObject({ timezone: "America/Mexico_City" });
    expect(upd.entry.after).toMatchObject({ timezone: "America/Cancun" });
    expect(upd.entry.ip).toBe("127.0.0.1");
    expect(upd.entry.deviceId).toBe("test-device");
  });
});

describe("usuarios y roles", () => {
  let f: Fixture;
  beforeEach(async () => {
    await resetDatabase();
    f = await createTenantFixture();
  });

  it("el dueño crea un usuario con rol y sucursales; la contraseña temporal sirve una vez", async () => {
    const owner = await contextFor(f.owner);
    const { user, temporaryPassword } = await createUser(owner, {
      username: "Ana.Lopez",
      fullName: "Ana López",
      email: "ana@example.com",
      roleId: await systemRoleId("cashier"),
      branchIds: [f.branch.id],
    });
    expect(user.username).toBe("ana.lopez");
    expect(temporaryPassword).toBeTruthy();
    const list = await listUsers(owner);
    const ana = list.find((u) => u.id === user.id)!;
    expect(ana.roleKey).toBe("cashier");
    expect(ana.branchIds).toEqual([f.branch.id]);
    const s = await login({ username: "ana.lopez", password: temporaryPassword! });
    expect(s.mustChangePassword).toBe(true);
    await expect(createUser(owner, { username: "ana.lopez", fullName: "Otra", roleId: await systemRoleId("cashier") })).rejects.toThrow(ValidationError);
  });

  it("AC-07: el gerente no delega permisos que no tiene ni sucursales fuera de su alcance", async () => {
    const owner = await contextFor(f.owner);
    const other = await createBranch(owner, { code: "OTRA", name: "Otra" });
    const manager = await contextFor(f.manager);
    const assignable = await listAssignableRoles(manager);
    expect(assignable.map((r) => r.key).sort()).toEqual(["cashier", "manager"]);
    await expect(
      createUser(manager, { username: "nuevo.dueno", fullName: "Nuevo", roleId: await systemRoleId("owner"), branchIds: [f.branch.id] }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      createUser(manager, { username: "nuevo.cajero", fullName: "Nuevo", roleId: await systemRoleId("cashier"), branchIds: [other.id] }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      createUser(manager, { username: "nuevo.cajero", fullName: "Nuevo", roleId: await systemRoleId("cashier"), branchIds: [] }),
    ).rejects.toThrow(ForbiddenError);
    const ok = await createUser(manager, { username: "nuevo.cajero", fullName: "Nuevo", roleId: await systemRoleId("cashier"), branchIds: [f.branch.id] });
    expect(ok.user.id).toBeTruthy();
    // El gerente no puede restablecer la contraseña del dueño.
    await expect(resetUserPassword(manager, f.owner.id)).rejects.toThrow(ForbiddenError);
    // El cajero no administra usuarios.
    const cashier = await contextFor(f.cashier);
    await expect(listUsers(cashier)).rejects.toThrow(ForbiddenError);
  });

  it("AC-07: no se puede desactivar al último dueño ni a uno mismo; desactivar revoca sesiones", async () => {
    const owner = await contextFor(f.owner);
    await expect(setUserActive(owner, f.owner.id, false)).rejects.toThrow(/ti mismo/);
    await expect(setUserAccess(owner, f.owner.id, { roleId: await systemRoleId("cashier"), branchIds: [] })).rejects.toThrow(/propio rol/);
    const second = await createUser(owner, { username: "dueno2", fullName: "Dueño 2", roleId: await systemRoleId("owner") });
    const owner2 = await contextFor(second.user);
    // owner2 puede degradar al primero porque queda él como dueño.
    await setUserAccess(owner2, f.owner.id, { roleId: await systemRoleId("manager"), branchIds: [] });
    // ...pero ahora nadie puede quitar a owner2 (último dueño).
    const ownerAsManager = await contextFor(f.owner);
    expect(ownerAsManager.roleKey).toBe("manager");
    await expect(setUserActive(owner2, f.owner.id, false)).resolves.toBeUndefined();
    const s = await login({ username: f.cashier.username, password: PASSWORD });
    await setUserActive(owner2, f.cashier.id, false, "baja");
    const [row] = await db.select().from(sessions).where(eq(sessions.id, s.sessionId));
    expect(row.revokedAt).not.toBeNull();
    await expect(login({ username: f.cashier.username, password: PASSWORD })).rejects.toThrow(/desactivado/);
    const { items } = await queryAudit({ tenantId: f.tenant.id, action: "users.deactivate" });
    expect(items.some((i) => i.entry.reason === "baja")).toBe(true);
  });

  it("roles personalizados: solo con permisos propios, sin editar los del sistema", async () => {
    const owner = await contextFor(f.owner);
    const role = await createRole(owner, { key: "supervisor", name: "Supervisor", permissions: ["pos.sell", "pos.discount", "reports.view", "platform.tenants.manage", "inexistente"] });
    expect(role.permissions.sort()).toEqual(["pos.discount", "pos.sell", "reports.view"]);
    const all = await listRoles(owner);
    expect(all.filter((r) => r.isSystem)).toHaveLength(4);
    expect(all.some((r) => r.key === "supervisor")).toBe(true);
    await expect(updateRole(owner, await systemRoleId("cashier"), { name: "x", permissions: [] })).rejects.toThrow(ConflictError);
    const manager = await contextFor(f.manager);
    await expect(createRole(manager, { key: "x", name: "Rol X", permissions: ["roles.manage"] })).rejects.toThrow(ForbiddenError);
    await expect(createRole(manager, { key: "x", name: "Rol X", permissions: ["pos.sell"] })).rejects.toThrow(ForbiddenError); // sin roles.manage
  });
});

describe("AC-06: aislamiento entre tenants", () => {
  beforeEach(resetDatabase);

  it("un usuario no lee ni modifica datos de otro tenant; la respuesta es 'no encontrado'", async () => {
    const a = await createTenantFixture("a");
    const b = await createTenantFixture("b");
    const ownerA = await contextFor(a.owner);
    await expect(getCompany(ownerA, b.company.id)).rejects.toThrow(NotFoundError);
    await expect(getBranch(ownerA, b.branch.id)).rejects.toThrow(NotFoundError);
    await expect(updateCompany(ownerA, b.company.id, { legalName: "Hack SA", tradeName: "Hack", currency: "MXN", timezone: "America/Mexico_City", locale: "es-MX", dateFormat: "dd/MM/yyyy" })).rejects.toThrow(NotFoundError);
    await expect(setCompanyModules(ownerA, b.company.id, [])).rejects.toThrow(NotFoundError);
    await expect(createWarehouse(ownerA, { branchId: b.branch.id, code: "X", name: "Intruso", isDefault: false, allowsNegativeStock: false })).rejects.toThrow(NotFoundError);
    await expect(setUserActive(ownerA, b.cashier.id, false)).rejects.toThrow(NotFoundError);
    expect((await listUsers(ownerA)).some((u) => u.id === b.owner.id)).toBe(false);
    expect((await listCompanies(ownerA)).some((c) => c.id === b.company.id)).toBe(false);
    // La bitácora solo muestra el propio tenant.
    const { items } = await queryAudit({ tenantId: a.tenant.id });
    expect(items.every((i) => i.entry.tenantId === a.tenant.id)).toBe(true);
    // Nada cambió en B.
    const [cb] = await db.select().from(branches).where(eq(branches.id, b.branch.id));
    expect(cb.name).toBe("Matriz");
    expect(await db.select().from(auditLog).where(eq(auditLog.tenantId, b.tenant.id))).toHaveLength(0);
  });

  it("mismo usuario en dos tenants: el login exige el identificador de cuenta", async () => {
    await createTenantFixture("a");
    await createTenantFixture("b");
    // Los usuarios de prueba llevan sufijo; creamos homónimos reales.
    const a = await createTenantFixture("c");
    const b = await createTenantFixture("d");
    const ctxA = await contextFor(a.owner);
    const ctxB = await contextFor(b.owner);
    await createUser(ctxA, { username: "maria", fullName: "María", roleId: await systemRoleId("cashier"), password: "Maria1234" });
    await createUser(ctxB, { username: "maria", fullName: "María", roleId: await systemRoleId("cashier"), password: "Maria1234" });
    await expect(login({ username: "maria", password: "Maria1234" })).rejects.toThrow(/más de una cuenta/);
    const s = await login({ username: "maria", password: "Maria1234", tenantSlug: "d" });
    expect(s.tenantId).toBe(b.tenant.id);
  });
});
