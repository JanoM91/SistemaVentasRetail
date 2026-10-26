import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { companies, roles, tenants, userCompanyRoles, users } from "@/server/db/schema";
import { recordAudit } from "@/server/audit";
import { requirePermission } from "@/server/authz/guard";
import { generateTemporaryPassword, hashPassword, passwordPolicyErrors } from "@/server/auth/password";
import { revokeAllUserSessions } from "@/server/auth/session";
import { NotFoundError, ValidationError } from "@/server/errors";
import type { ServiceContext } from "@/server/service-context";
import { parseOrThrow } from "@/server/validation";
import { provisionCompany } from "@/server/modules/companies/provision";
import { CURRENCIES, LOCALES, nameSchema, TIMEZONES } from "@/server/modules/companies/validation";

export const tenantSchema = z.object({
  name: nameSchema,
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Mínimo 3 caracteres")
    .max(40, "Máximo 40 caracteres")
    .regex(/^[a-z0-9-]+$/, "Solo minúsculas, números y guiones"),
  country: z.string().trim().length(2, "Código de país de 2 letras").toUpperCase().default("MX"),
  currency: z.enum(CURRENCIES).default("MXN"),
  timezone: z.enum(TIMEZONES).default("America/Mexico_City"),
  locale: z.enum(LOCALES).default("es-MX"),
  companyTradeName: nameSchema,
  companyLegalName: nameSchema.optional().or(z.literal("")),
  ownerFullName: nameSchema,
  ownerUsername: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Mínimo 3 caracteres")
    .max(40)
    .regex(/^[a-z0-9._-]+$/, "Solo minúsculas, números, punto, guion y guion bajo"),
  ownerEmail: z.string().trim().email("Correo inválido").optional().or(z.literal("")),
  ownerPassword: z.string().optional().or(z.literal("")),
});
export type TenantInput = z.infer<typeof tenantSchema>;

export async function listTenants(ctx: ServiceContext) {
  requirePermission(ctx, "platform.tenants.manage");
  return db
    .select({
      tenant: tenants,
      companyCount: sql<number>`(select count(*) from ${companies} c where c.tenant_id = ${tenants.id})`.mapWith(Number),
      userCount: sql<number>`(select count(*) from ${users} u where u.tenant_id = ${tenants.id})`.mapWith(Number),
    })
    .from(tenants)
    .orderBy(desc(tenants.createdAt));
}

export async function getTenantDetail(ctx: ServiceContext, tenantId: string) {
  requirePermission(ctx, "platform.tenants.manage");
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new NotFoundError("La cuenta");
  const companyRows = await db
    .select()
    .from(companies)
    .where(eq(companies.tenantId, tenantId))
    .orderBy(asc(companies.tradeName));
  const owners = await db
    .select({ id: users.id, username: users.username, fullName: users.fullName, status: users.status, email: users.email })
    .from(users)
    .innerJoin(userCompanyRoles, eq(userCompanyRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userCompanyRoles.roleId))
    .where(and(eq(users.tenantId, tenantId), eq(roles.key, "owner")))
    .groupBy(users.id);
  return { tenant, companies: companyRows, owners };
}

/**
 * Crea un tenant con empresa, sucursal, almacén, caja y usuario dueño.
 * Devuelve la contraseña temporal una sola vez.
 */
export async function createTenant(ctx: ServiceContext, raw: unknown) {
  requirePermission(ctx, "platform.tenants.manage");
  const input = parseOrThrow(tenantSchema, raw);
  const password = input.ownerPassword || generateTemporaryPassword();
  if (input.ownerPassword) {
    const errors = passwordPolicyErrors(input.ownerPassword);
    if (errors.length) throw new ValidationError({ ownerPassword: errors });
  }
  const passwordHash = await hashPassword(password);

  return db.transaction(async (tx) => {
    const [tenant] = await tx
      .insert(tenants)
      .values({
        name: input.name,
        slug: input.slug,
        country: input.country,
        defaultCurrency: input.currency,
        defaultTimezone: input.timezone,
        defaultLocale: input.locale,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();

    const [owner] = await tx
      .insert(users)
      .values({
        tenantId: tenant.id,
        username: input.ownerUsername,
        email: input.ownerEmail || null,
        fullName: input.ownerFullName,
        passwordHash,
        mustChangePassword: !input.ownerPassword,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();

    const provisioned = await provisionCompany(tx, {
      tenantId: tenant.id,
      createdBy: ctx.userId,
      company: {
        code: "EMP1",
        tradeName: input.companyTradeName,
        legalName: input.companyLegalName || input.companyTradeName,
        currency: input.currency,
        timezone: input.timezone,
        locale: input.locale,
        dateFormat: "dd/MM/yyyy",
        taxId: "",
        taxRegime: "",
      },
    });

    const [ownerRole] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.key, "owner"), isNull(roles.tenantId)))
      .limit(1);
    if (!ownerRole) throw new Error("Falta el rol de sistema 'owner'. Ejecuta las semillas.");
    await tx.insert(userCompanyRoles).values({
      tenantId: tenant.id,
      userId: owner.id,
      companyId: provisioned.company.id,
      roleId: ownerRole.id,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    });

    await recordAudit(tx, { ...ctx.actor, tenantId: tenant.id, companyId: provisioned.company.id, branchId: null }, {
      action: "platform.tenants.create",
      entity: "tenant",
      entityId: tenant.id,
      after: { name: tenant.name, slug: tenant.slug, ownerUsername: owner.username, companyId: provisioned.company.id },
    });
    // También en la bitácora del tenant de plataforma, para rastrear quién creó qué.
    await recordAudit(tx, ctx.actor, {
      action: "platform.tenants.create",
      entity: "tenant",
      entityId: tenant.id,
      after: { name: tenant.name, slug: tenant.slug },
    });

    return { tenant, owner, company: provisioned.company, temporaryPassword: input.ownerPassword ? null : password };
  });
}

export async function setTenantStatus(ctx: ServiceContext, tenantId: string, status: "active" | "suspended", reason?: string) {
  requirePermission(ctx, "platform.tenants.manage");
  const [before] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!before) throw new NotFoundError("La cuenta");
  return db.transaction(async (tx) => {
    await tx.update(tenants).set({ status, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(tenants.id, tenantId));
    if (status === "suspended") {
      const tenantUsers = await tx.select({ id: users.id }).from(users).where(eq(users.tenantId, tenantId));
      for (const u of tenantUsers) await revokeAllUserSessions(u.id, tx);
    }
    await recordAudit(tx, ctx.actor, {
      action: status === "suspended" ? "platform.tenants.suspend" : "platform.tenants.activate",
      entity: "tenant",
      entityId: tenantId,
      reason,
      before: { status: before.status },
      after: { status },
    });
  });
}

/** Restablece la contraseña de un dueño (soporte). Devuelve la temporal una sola vez. */
export async function resetOwnerPassword(ctx: ServiceContext, tenantId: string, userId: string) {
  requirePermission(ctx, "platform.tenants.manage");
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
    .limit(1);
  if (!user) throw new NotFoundError("El usuario");
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, mustChangePassword: true, failedLoginAttempts: 0, lockedUntil: null, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(users.id, userId));
    await revokeAllUserSessions(userId, tx);
    await recordAudit(tx, { ...ctx.actor, tenantId }, {
      action: "platform.users.reset_password",
      entity: "user",
      entityId: userId,
      after: { username: user.username },
    });
  });
  return { temporaryPassword };
}
