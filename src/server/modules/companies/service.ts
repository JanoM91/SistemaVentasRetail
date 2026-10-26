import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { companies, companyModules, MODULE_KEYS, roles, userCompanyRoles, type ModuleKey } from "@/server/db/schema";
import { recordAudit } from "@/server/audit";
import { requirePermission } from "@/server/authz/guard";
import { ConflictError, NotFoundError } from "@/server/errors";
import type { ServiceContext } from "@/server/service-context";
import { parseOrThrow } from "@/server/validation";
import { provisionCompany } from "./provision";
import { companySchema, companySettingsSchema, companyUpdateSchema } from "./validation";

export type CompanyRow = typeof companies.$inferSelect;

export async function listCompanies(ctx: ServiceContext) {
  requirePermission(ctx, "companies.view");
  return db
    .select()
    .from(companies)
    .where(eq(companies.tenantId, ctx.tenantId))
    .orderBy(asc(companies.tradeName));
}

export async function getCompany(ctx: ServiceContext, companyId: string): Promise<CompanyRow> {
  requirePermission(ctx, "companies.view");
  const [row] = await db
    .select()
    .from(companies)
    .where(and(eq(companies.id, companyId), eq(companies.tenantId, ctx.tenantId)))
    .limit(1);
  if (!row) throw new NotFoundError("La empresa");
  return row;
}

/**
 * Crea una empresa en el tenant del contexto con su estructura por defecto y
 * asigna al creador el rol de dueño en ella.
 */
export async function createCompany(ctx: ServiceContext, raw: unknown) {
  requirePermission(ctx, "companies.manage");
  const input = parseOrThrow(companySchema, raw);
  return db.transaction(async (tx) => {
    const result = await provisionCompany(tx, {
      tenantId: ctx.tenantId,
      company: input,
      createdBy: ctx.userId,
    });
    // El creador queda como dueño de la nueva empresa (si tiene rol de sistema owner).
    const [ownerRole] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.key, "owner"), isNull(roles.tenantId)))
      .limit(1);
    if (ownerRole) {
      await tx
        .insert(userCompanyRoles)
        .values({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          companyId: result.company.id,
          roleId: ownerRole.id,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .onConflictDoNothing();
    }
    await recordAudit(tx, ctx.actor, {
      action: "companies.create",
      entity: "company",
      entityId: result.company.id,
      companyId: result.company.id,
      after: { code: result.company.code, tradeName: result.company.tradeName, legalName: result.company.legalName },
    });
    return result.company;
  });
}

export async function updateCompany(ctx: ServiceContext, companyId: string, raw: unknown) {
  requirePermission(ctx, "companies.manage");
  const input = parseOrThrow(companyUpdateSchema, raw);
  const before = await getCompany(ctx, companyId);
  return db.transaction(async (tx) => {
    const [after] = await tx
      .update(companies)
      .set({
        legalName: input.legalName,
        tradeName: input.tradeName,
        taxId: input.taxId || null,
        taxRegime: input.taxRegime || null,
        currency: input.currency,
        timezone: input.timezone,
        locale: input.locale,
        dateFormat: input.dateFormat,
        address: input.address ?? before.address,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(and(eq(companies.id, companyId), eq(companies.tenantId, ctx.tenantId)))
      .returning();
    await recordAudit(tx, ctx.actor, {
      action: "companies.update",
      entity: "company",
      entityId: companyId,
      companyId,
      before: pick(before),
      after: pick(after),
    });
    return after;
  });
}

export async function updateCompanySettings(ctx: ServiceContext, companyId: string, raw: unknown) {
  requirePermission(ctx, "settings.manage");
  const input = parseOrThrow(companySettingsSchema, raw);
  const before = await getCompany(ctx, companyId);
  return db.transaction(async (tx) => {
    const settings = {
      ...before.settings,
      inventory: input.inventory,
      promotions: input.promotions,
      pos: input.pos,
      notifications: { lowStockEmail: input.notifications.lowStockEmail || null },
    };
    const [after] = await tx
      .update(companies)
      .set({ settings, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(and(eq(companies.id, companyId), eq(companies.tenantId, ctx.tenantId)))
      .returning();
    await recordAudit(tx, ctx.actor, {
      action: "settings.update",
      entity: "company",
      entityId: companyId,
      companyId,
      before: { settings: before.settings },
      after: { settings: after.settings },
    });
    return after;
  });
}

export async function setCompanyActive(ctx: ServiceContext, companyId: string, active: boolean, reason?: string) {
  requirePermission(ctx, "companies.manage");
  const before = await getCompany(ctx, companyId);
  if (!active) {
    const activeCount = (await listCompanies(ctx)).filter((c) => !c.deactivatedAt).length;
    if (activeCount <= 1) throw new ConflictError("No puedes desactivar la única empresa activa.");
  }
  return db.transaction(async (tx) => {
    const [after] = await tx
      .update(companies)
      .set(
        active
          ? { deactivatedAt: null, deactivatedBy: null, updatedAt: new Date(), updatedBy: ctx.userId }
          : { deactivatedAt: new Date(), deactivatedBy: ctx.userId, updatedAt: new Date(), updatedBy: ctx.userId },
      )
      .where(and(eq(companies.id, companyId), eq(companies.tenantId, ctx.tenantId)))
      .returning();
    await recordAudit(tx, ctx.actor, {
      action: active ? "companies.activate" : "companies.deactivate",
      entity: "company",
      entityId: companyId,
      companyId,
      reason,
      before: { active: !before.deactivatedAt },
      after: { active: !after.deactivatedAt },
    });
    return after;
  });
}

export async function listCompanyModules(ctx: ServiceContext, companyId: string) {
  requirePermission(ctx, "settings.view");
  await getCompany(ctx, companyId);
  const rows = await db
    .select()
    .from(companyModules)
    .where(eq(companyModules.companyId, companyId));
  const byKey = new Map(rows.map((r) => [r.module, r]));
  return MODULE_KEYS.map((module) => ({
    module,
    enabled: byKey.get(module)?.enabled ?? false,
  }));
}

/** Enciende o apaga módulos de una empresa (el permiso se valida contra el contexto). */
export async function setCompanyModules(
  ctx: ServiceContext,
  companyId: string,
  enabledModules: readonly string[],
  opts: { permission?: "settings.manage" | "platform.tenants.manage"; tenantId?: string } = {},
) {
  requirePermission(ctx, opts.permission ?? "settings.manage");
  const tenantId = opts.tenantId ?? ctx.tenantId;
  const [company] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.id, companyId), eq(companies.tenantId, tenantId)))
    .limit(1);
  if (!company) throw new NotFoundError("La empresa");
  const wanted = new Set(enabledModules.filter((m): m is ModuleKey => (MODULE_KEYS as readonly string[]).includes(m)));
  const before = await db.select().from(companyModules).where(eq(companyModules.companyId, companyId));
  return db.transaction(async (tx) => {
    for (const key of MODULE_KEYS) {
      await tx
        .insert(companyModules)
        .values({ companyId, module: key, enabled: wanted.has(key), createdBy: ctx.userId, updatedBy: ctx.userId })
        .onConflictDoUpdate({
          target: [companyModules.companyId, companyModules.module],
          set: { enabled: wanted.has(key), updatedAt: new Date(), updatedBy: ctx.userId },
        });
    }
    await recordAudit(tx, { ...ctx.actor, tenantId }, {
      action: "settings.modules",
      entity: "company",
      entityId: companyId,
      companyId,
      before: { enabled: before.filter((b) => b.enabled).map((b) => b.module).sort() },
      after: { enabled: [...wanted].sort() },
    });
  });
}

function pick(c: CompanyRow) {
  return {
    legalName: c.legalName,
    tradeName: c.tradeName,
    taxId: c.taxId,
    taxRegime: c.taxRegime,
    currency: c.currency,
    timezone: c.timezone,
    locale: c.locale,
    dateFormat: c.dateFormat,
    address: c.address,
  };
}
