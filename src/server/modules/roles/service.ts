import { and, asc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { roles, userCompanyRoles } from "@/server/db/schema";
import { recordAudit } from "@/server/audit";
import { permissionsNotDelegable, requirePermission } from "@/server/authz/guard";
import { isPermission, type Permission } from "@/server/authz/permissions";
import { ConflictError, ForbiddenError, NotFoundError } from "@/server/errors";
import type { ServiceContext } from "@/server/service-context";
import { parseOrThrow } from "@/server/validation";
import { nameSchema } from "@/server/modules/companies/validation";

export const roleSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "Mínimo 2 caracteres")
    .max(30, "Máximo 30 caracteres")
    .regex(/^[a-z0-9_]+$/, "Solo minúsculas, números y guion bajo"),
  name: nameSchema,
  description: z.string().trim().max(300).optional().or(z.literal("")),
  permissions: z.array(z.string()).default([]),
});
export const roleUpdateSchema = roleSchema.omit({ key: true });

export type RoleRow = typeof roles.$inferSelect;

/** Roles disponibles para el tenant: del sistema + personalizados. */
export async function listRoles(ctx: ServiceContext, opts: { includeInactive?: boolean } = {}) {
  requirePermission(ctx, "roles.view");
  const rows = await db
    .select()
    .from(roles)
    .where(or(isNull(roles.tenantId), eq(roles.tenantId, ctx.tenantId)))
    .orderBy(asc(roles.isSystem), asc(roles.name));
  return rows.filter((r) => opts.includeInactive || !r.deactivatedAt);
}

export async function getRole(ctx: ServiceContext, roleId: string): Promise<RoleRow> {
  requirePermission(ctx, "roles.view");
  const [row] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.id, roleId), or(isNull(roles.tenantId), eq(roles.tenantId, ctx.tenantId))))
    .limit(1);
  if (!row) throw new NotFoundError("El rol");
  return row;
}

/** Roles que el usuario actual puede asignar (permisos ⊆ los suyos, sin plataforma). */
export async function listAssignableRoles(ctx: ServiceContext) {
  const all = await listRoles(ctx);
  return all.filter(
    (r) =>
      r.key !== "superadmin" &&
      permissionsNotDelegable(ctx, r.permissions.filter(isPermission)).length === 0,
  );
}

function cleanPermissions(ctx: ServiceContext, list: string[]): Permission[] {
  const valid = list.filter(isPermission).filter((p) => !p.startsWith("platform."));
  const missing = permissionsNotDelegable(ctx, valid);
  if (missing.length) {
    throw new ForbiddenError(missing[0], `No puedes otorgar permisos que no tienes: ${missing.join(", ")}.`);
  }
  return [...new Set(valid)];
}

export async function createRole(ctx: ServiceContext, raw: unknown) {
  requirePermission(ctx, "roles.manage");
  const input = parseOrThrow(roleSchema, raw);
  const permissions = cleanPermissions(ctx, input.permissions);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(roles)
      .values({
        tenantId: ctx.tenantId,
        key: input.key,
        name: input.name,
        description: input.description || null,
        isSystem: false,
        permissions,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    await recordAudit(tx, ctx.actor, {
      action: "roles.create",
      entity: "role",
      entityId: row.id,
      after: { key: row.key, name: row.name, permissions },
    });
    return row;
  });
}

export async function updateRole(ctx: ServiceContext, roleId: string, raw: unknown) {
  requirePermission(ctx, "roles.manage");
  const before = await getRole(ctx, roleId);
  if (before.isSystem) throw new ConflictError("Los roles del sistema no se editan. Duplícalo como rol personalizado.");
  const input = parseOrThrow(roleUpdateSchema, raw);
  const permissions = cleanPermissions(ctx, input.permissions);
  return db.transaction(async (tx) => {
    const [after] = await tx
      .update(roles)
      .set({ name: input.name, description: input.description || null, permissions, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(and(eq(roles.id, roleId), eq(roles.tenantId, ctx.tenantId)))
      .returning();
    await recordAudit(tx, ctx.actor, {
      action: "roles.update",
      entity: "role",
      entityId: roleId,
      before: { name: before.name, description: before.description, permissions: before.permissions },
      after: { name: after.name, description: after.description, permissions: after.permissions },
    });
    return after;
  });
}

export async function deactivateRole(ctx: ServiceContext, roleId: string, reason?: string) {
  requirePermission(ctx, "roles.manage");
  const before = await getRole(ctx, roleId);
  if (before.isSystem) throw new ConflictError("Los roles del sistema no se desactivan.");
  const [inUse] = await db
    .select({ userId: userCompanyRoles.userId })
    .from(userCompanyRoles)
    .where(eq(userCompanyRoles.roleId, roleId))
    .limit(1);
  if (inUse) throw new ConflictError("Hay usuarios con este rol. Reasígnalos antes de desactivarlo.");
  return db.transaction(async (tx) => {
    await tx
      .update(roles)
      .set({ deactivatedAt: new Date(), deactivatedBy: ctx.userId, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(roles.id, roleId));
    await recordAudit(tx, ctx.actor, {
      action: "roles.deactivate",
      entity: "role",
      entityId: roleId,
      reason,
      before: { active: true, key: before.key },
      after: { active: false, key: before.key },
    });
  });
}
