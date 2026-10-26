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
import { resolveAuthz } from "../src/server/authz/resolve";
import { createProduct } from "../src/server/modules/catalog/service";
import { ensureCatalogDefaults } from "../src/server/modules/catalog/defaults";
import { db, pool } from "../src/server/db";
import {
  branches,
  companies,
  products,
  taxProfiles,
  unitsOfMeasure,
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

/** Catálogo de demostración (idempotente): abarrotes, granel y ropa con variantes. */
async function seedDemoCatalog() {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, "demo")).limit(1);
  if (!tenant) return;
  const [owner] = await db.select().from(users).where(and(eq(users.tenantId, tenant.id), eq(users.username, DEMO.owner.username))).limit(1);
  const [company] = await db.select().from(companies).where(eq(companies.tenantId, tenant.id)).limit(1);
  const [centro] = await db.select().from(branches).where(and(eq(branches.companyId, company.id), eq(branches.code, "CENTRO"))).limit(1);
  const [already] = await db.select({ id: products.id }).from(products).where(eq(products.companyId, company.id)).limit(1);
  if (already) {
    console.log("· Catálogo demo ya existe");
    return;
  }
  await ensureCatalogDefaults(db, tenant.id, company.id, owner.id);
  const authz = await resolveAuthz({ userId: owner.id, tenantId: tenant.id, isSuperadmin: false, requestedCompanyId: company.id, requestedBranchId: centro.id });
  const ctx = { ...authz, actor: { tenantId: tenant.id, userId: owner.id, companyId: company.id, branchId: centro.id, ip: null, userAgent: "seed", deviceId: "seed" } };
  const unit = async (code: string) => (await db.select().from(unitsOfMeasure).where(and(eq(unitsOfMeasure.companyId, company.id), eq(unitsOfMeasure.code, code))))[0].id;
  const tax = async (code: string) => (await db.select().from(taxProfiles).where(and(eq(taxProfiles.companyId, company.id), eq(taxProfiles.code, code))))[0].id;
  const PZA = await unit("PZA");
  const KG = await unit("KG");
  const IVA16 = await tax("IVA16");
  const IVA0 = await tax("IVA0");
  const simple = (name: string, sku: string, cat: string, price: string, cost: string | null, stock: number, opts: { barcode?: string; unitId?: string; taxId?: string; fav?: boolean; brand?: string } = {}) =>
    createProduct(ctx, {
      name, sku, kind: "simple", categoryName: cat, brandName: opts.brand ?? "", unitId: opts.unitId ?? PZA, taxProfileId: opts.taxId ?? IVA16, isFavorite: opts.fav ?? false,
      variants: [{ sku, price, cost, barcodes: opts.barcode ? [opts.barcode] : [], initialStock: stock, minStock: null, reorderPoint: "5" }],
    });
  await simple("Refresco de cola 600 ml", "REF-COLA-600", "Bebidas", "18.50", "11.20", 48, { barcode: "7500000000011", fav: true, brand: "Genérica" });
  await simple("Agua natural 1 L", "AGUA-1L", "Bebidas", "12.00", "6.50", 36, { barcode: "7500000000028", fav: true });
  await simple("Jugo de naranja 1 L", "JUGO-NAR-1L", "Bebidas", "32.00", "21.00", 12, { barcode: "7500000000035" });
  await simple("Papas fritas 45 g", "PAPAS-45", "Botanas", "19.00", "12.40", 30, { barcode: "7500000000042", fav: true });
  await simple("Galletas de avena 300 g", "GALL-AVENA", "Botanas", "35.00", null, 15, { barcode: "7500000000059" });
  await simple("Arroz blanco 1 kg", "ARROZ-1K", "Abarrotes", "29.90", "19.50", 20, { barcode: "7500000000066", taxId: IVA0 });
  await simple("Frijol negro 1 kg", "FRIJOL-1K", "Abarrotes", "42.00", "30.00", 3, { barcode: "7500000000073", taxId: IVA0 });
  await simple("Huevo blanco (granel)", "HUEVO-KG", "Abarrotes", "48.00", "38.00", 10, { unitId: KG, taxId: IVA0, fav: true });
  await simple("Jitomate saladet (granel)", "JITO-KG", "Frutas y verduras", "32.90", "22.00", 8.5, { unitId: KG, taxId: IVA0, fav: true });
  await simple("Bolsa reutilizable", "BOLSA", "Varios", "15.00", "6.00", 50, { fav: true });
  await createProduct(ctx, {
    name: "Playera básica algodón", sku: "PLAY", kind: "variable", categoryName: "Ropa", brandName: "Exk Basics", unitId: PZA, taxProfileId: IVA16, isFavorite: true,
    attributeNames: ["Talla", "Color"],
    variants: [
      { sku: "PLAY-CH-NEG", attributeValues: { Talla: "CH", Color: "Negro" }, price: "199", cost: "85", barcodes: ["7500000001001"], initialStock: 6 },
      { sku: "PLAY-M-NEG", attributeValues: { Talla: "M", Color: "Negro" }, price: "199", cost: "85", barcodes: ["7500000001002"], initialStock: 8 },
      { sku: "PLAY-G-NEG", attributeValues: { Talla: "G", Color: "Negro" }, price: "219", cost: "90", barcodes: ["7500000001003"], initialStock: 4 },
      { sku: "PLAY-M-BCO", attributeValues: { Talla: "M", Color: "Blanco" }, price: "199", cost: "85", barcodes: ["7500000001004"], initialStock: 5 },
    ],
  });
  console.log("✔ Catálogo demo: 11 productos (uno con 4 variantes) con existencias en Sucursal Centro");
}

async function main() {
  await seedSystemRoles();
  await seedCurrencies();
  await seedPlatform();
  await seedDemo();
  await seedDemoCatalog();
  console.log("\nCredenciales de demostración:");
  for (const [k, v] of Object.entries(DEMO)) console.log(`  ${k.padEnd(10)} ${v.username} / ${v.password}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
