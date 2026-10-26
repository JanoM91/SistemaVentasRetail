/**
 * Semillas: roles del sistema, monedas, tenant de plataforma con superadministrador
 * y un tenant de demostración con dueño, gerente y cajero.
 *
 * Uso: npm run db:seed   (idempotente: no duplica lo que ya existe)
 *
 * Credenciales de demostración (cámbialas en producción):
 *   superadmin / Admin1234!   (plataforma)
 *   dueno      / Dueno1234!   (tenant "demo")
 *   gerente    / Gerente1234! (tenant "demo", sucursal Centro)
 *   cajero     / Cajero1234!  (tenant "demo", sucursal Centro)
 */
import "dotenv/config";
import { and, eq, isNull } from "drizzle-orm";
import { db, pool } from "../src/server/db";
import {
  branches,
  cashRegisters,
  currencies,
  roles,
  tenants,
  userBranches,
  userCompanyRoles,
  users,
  warehouses,
} from "../src/server/db/schema";
import { SYSTEM_ROLES } from "../src/server/authz/system-roles";
import { hashPassword } from "../src/server/auth/password";
import { provisionCompany } from "../src/server/modules/companies/provision";

const DEMO = {
  superadmin: { username: "superadmin", password: process.env.SEED_SUPERADMIN_PASSWORD ?? "Admin1234!" },
  owner: { username: "dueno", password: process.env.SEED_OWNER_PASSWORD ?? "Dueno1234!" },
  manager: { username: "gerente", password: process.env.SEED_MANAGER_PASSWORD ?? "Gerente1234!" },
  cashier: { username: "cajero", password: process.env.SEED_CASHIER_PASSWORD ?? "Cajero1234!" },
};

async function seedSystemRoles() {
  for (const role of SYSTEM_ROLES) {
    const [existing] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(and(isNull(roles.tenantId), eq(roles.key, role.key)))
      .limit(1);
    if (existing) {
      await db
        .update(roles)
        .set({ name: role.name, description: role.description, permissions: [...role.permissions], updatedAt: new Date() })
        .where(eq(roles.id, existing.id));
    } else {
      await db.insert(roles).values({
        tenantId: null,
        key: role.key,
        name: role.name,
        description: role.description,
        isSystem: true,
        permissions: [...role.permissions],
      });
    }
  }
  console.log(`✔ Roles del sistema: ${SYSTEM_ROLES.map((r) => r.key).join(", ")}`);
}

async function seedCurrencies() {
  await db
    .insert(currencies)
    .values([
      { code: "MXN", name: "Peso mexicano", symbol: "$", minorUnit: 2 },
      { code: "USD", name: "Dólar estadounidense", symbol: "US$", minorUnit: 2 },
      { code: "COP", name: "Peso colombiano", symbol: "$", minorUnit: 2 },
      { code: "PEN", name: "Sol peruano", symbol: "S/", minorUnit: 2 },
      { code: "CLP", name: "Peso chileno", symbol: "$", minorUnit: 0 },
      { code: "ARS", name: "Peso argentino", symbol: "$", minorUnit: 2 },
      { code: "GTQ", name: "Quetzal", symbol: "Q", minorUnit: 2 },
      { code: "EUR", name: "Euro", symbol: "€", minorUnit: 2 },
    ])
    .onConflictDoNothing();
  console.log("✔ Monedas");
}

async function seedPlatform() {
  const [existing] = await db.select().from(tenants).where(eq(tenants.slug, "plataforma")).limit(1);
  if (existing) {
    console.log("· Tenant de plataforma ya existe");
    return;
  }
  const [tenant] = await db
    .insert(tenants)
    .values({ name: "Plataforma", slug: "plataforma", plan: "platform" })
    .returning();
  await db.insert(users).values({
    tenantId: tenant.id,
    username: DEMO.superadmin.username,
    fullName: "Superadministrador",
    email: "soporte@example.com",
    passwordHash: await hashPassword(DEMO.superadmin.password),
    isSuperadmin: true,
  });
  console.log(`✔ Tenant de plataforma y usuario ${DEMO.superadmin.username}`);
}

async function seedDemo() {
  const [existing] = await db.select().from(tenants).where(eq(tenants.slug, "demo")).limit(1);
  if (existing) {
    console.log("· Tenant demo ya existe");
    return;
  }
  const roleByKey = Object.fromEntries(
    (await db.select().from(roles).where(isNull(roles.tenantId))).map((r) => [r.key, r.id]),
  );

  await db.transaction(async (tx) => {
    const [tenant] = await tx
      .insert(tenants)
      .values({ name: "Tienda Demo", slug: "demo" })
      .returning();

    const { company, branch } = await provisionCompany(tx, {
      tenantId: tenant.id,
      createdBy: null,
      company: {
        code: "DEMO",
        tradeName: "Tienda Demo",
        legalName: "Tienda Demo S.A. de C.V.",
        taxId: "XAXX010101000",
        taxRegime: "601",
        currency: "MXN",
        timezone: "America/Mexico_City",
        locale: "es-MX",
        dateFormat: "dd/MM/yyyy",
        address: { street: "Av. Principal", exteriorNumber: "100", city: "Xalapa", state: "Veracruz", postalCode: "91000", country: "MX" },
      },
      branch: { code: "CENTRO", name: "Sucursal Centro" },
    });

    const [north] = await tx
      .insert(branches)
      .values({ tenantId: tenant.id, companyId: company.id, code: "NORTE", name: "Sucursal Norte", phone: "2281234567" })
      .returning();
    await tx.insert(warehouses).values({
      tenantId: tenant.id, companyId: company.id, branchId: north.id, code: "NORTE-ALM", name: "Almacén principal", isDefault: true,
    });
    await tx.insert(cashRegisters).values({ tenantId: tenant.id, companyId: company.id, branchId: north.id, code: "CAJA1", name: "Caja 1" });

    const mk = async (u: { username: string; password: string }, fullName: string, roleKey: string, email: string) => {
      const [row] = await tx
        .insert(users)
        .values({ tenantId: tenant.id, username: u.username, fullName, email, passwordHash: await hashPassword(u.password) })
        .returning();
      await tx.insert(userCompanyRoles).values({ tenantId: tenant.id, userId: row.id, companyId: company.id, roleId: roleByKey[roleKey] });
      return row;
    };
    await mk(DEMO.owner, "Dueño Demo", "owner", "dueno@example.com");
    const manager = await mk(DEMO.manager, "Gerente Demo", "manager", "gerente@example.com");
    const cashier = await mk(DEMO.cashier, "Cajero Demo", "cashier", "cajero@example.com");
    await tx.insert(userBranches).values([
      { tenantId: tenant.id, userId: manager.id, branchId: branch.id },
      { tenantId: tenant.id, userId: cashier.id, branchId: branch.id },
    ]);
  });
  console.log(`✔ Tenant demo con empresa, 2 sucursales y usuarios ${DEMO.owner.username}, ${DEMO.manager.username}, ${DEMO.cashier.username}`);
}

async function main() {
  await seedSystemRoles();
  await seedCurrencies();
  await seedPlatform();
  await seedDemo();
  console.log("\nCredenciales de demostración:");
  for (const [k, v] of Object.entries(DEMO)) console.log(`  ${k.padEnd(10)} ${v.username} / ${v.password}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
