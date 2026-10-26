import { and, eq, isNull, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "@/server/db";
import { roles, tenants, userBranches, userCompanyRoles, users } from "@/server/db/schema";
import { SYSTEM_ROLES } from "@/server/authz/system-roles";
import { hashPassword } from "@/server/auth/password";
import { resolveAuthz } from "@/server/authz/resolve";
import type { ServiceContext } from "@/server/service-context";
import { provisionCompany } from "@/server/modules/companies/provision";

let migrated = false;

/** Aplica migraciones (una vez) y vacía todas las tablas. */
export async function resetDatabase() {
  if (!migrated) {
    await migrate(db, { migrationsFolder: "./drizzle" });
    migrated = true;
  }
  const tables = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  const names = tables.rows.map((r) => `"${r.tablename}"`).join(", ");
  if (names) await pool.query(`truncate ${names} restart identity cascade`);
  await seedSystemRoles();
}

export async function seedSystemRoles() {
  await db.insert(roles).values(
    SYSTEM_ROLES.map((r) => ({
      tenantId: null,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: true,
      permissions: [...r.permissions],
    })),
  );
}

export async function systemRoleId(key: string) {
  const [r] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(isNull(roles.tenantId), eq(roles.key, key)))
    .limit(1);
  return r.id;
}

export const PASSWORD = "Prueba1234";

export type Fixture = Awaited<ReturnType<typeof createTenantFixture>>;

/** Tenant con empresa, sucursal, dueño, gerente (restringido a la sucursal) y cajero. */
export async function createTenantFixture(slug = "acme") {
  const [tenant] = await db.insert(tenants).values({ name: `Tenant ${slug}`, slug }).returning();
  const { company, branch, warehouse, register } = await provisionCompany(db, {
    tenantId: tenant.id,
    createdBy: null,
    company: {
      code: "EMP1",
      tradeName: `Empresa ${slug}`,
      legalName: `Empresa ${slug} SA`,
      currency: "MXN",
      timezone: "America/Mexico_City",
      locale: "es-MX",
      dateFormat: "dd/MM/yyyy",
      taxId: "",
      taxRegime: "",
    },
  });
  const passwordHash = await hashPassword(PASSWORD);
  const mk = async (username: string, roleKey: string, restrict = false) => {
    const [u] = await db
      .insert(users)
      .values({ tenantId: tenant.id, username: `${username}_${slug}`, fullName: username, passwordHash })
      .returning();
    await db.insert(userCompanyRoles).values({
      tenantId: tenant.id,
      userId: u.id,
      companyId: company.id,
      roleId: await systemRoleId(roleKey),
    });
    if (restrict) await db.insert(userBranches).values({ tenantId: tenant.id, userId: u.id, branchId: branch.id });
    return u;
  };
  const owner = await mk("owner", "owner");
  const manager = await mk("manager", "manager", true);
  const cashier = await mk("cashier", "cashier", true);
  return { tenant, company, branch, warehouse, register, owner, manager, cashier };
}

export async function createPlatformFixture() {
  const [tenant] = await db.insert(tenants).values({ name: "Plataforma", slug: "plataforma", plan: "platform" }).returning();
  const [admin] = await db
    .insert(users)
    .values({ tenantId: tenant.id, username: "superadmin", fullName: "Super", passwordHash: await hashPassword(PASSWORD), isSuperadmin: true })
    .returning();
  return { tenant, admin };
}

/** Construye un ServiceContext para un usuario (como lo haría getRequestContext). */
export async function contextFor(
  user: { id: string; tenantId: string; isSuperadmin: boolean },
  opts: { companyId?: string; branchId?: string } = {},
): Promise<ServiceContext> {
  const authz = await resolveAuthz({
    userId: user.id,
    tenantId: user.tenantId,
    isSuperadmin: user.isSuperadmin,
    requestedCompanyId: opts.companyId,
    requestedBranchId: opts.branchId,
  });
  return {
    ...authz,
    actor: {
      tenantId: user.tenantId,
      userId: user.id,
      companyId: authz.company?.id ?? null,
      branchId: authz.branch?.id ?? null,
      ip: "127.0.0.1",
      userAgent: "vitest",
      deviceId: "test-device",
    },
  };
}

export async function countRows(table: string) {
  const r = await pool.query<{ n: string }>(`select count(*)::text as n from "${table}"`);
  return Number(r.rows[0].n);
}

export { sql };
