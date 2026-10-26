import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/server/db";
import { branches, roles, userBranches, userCompanyRoles, users } from "@/server/db/schema";
import { recordAudit } from "@/server/audit";
import { permissionsNotDelegable, requirePermission } from "@/server/authz/guard";
import { isPermission } from "@/server/authz/permissions";
import { generateTemporaryPassword, hashPassword, passwordPolicyErrors } from "@/server/auth/password";
import { revokeAllUserSessions } from "@/server/auth/session";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { requireCompany, type ServiceContext } from "@/server/service-context";
import { parseOrThrow } from "@/server/validation";
import { nameSchema } from "@/server/modules/companies/validation";
import { getRole } from "@/server/modules/roles/service";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Mínimo 3 caracteres")
  .max(40, "Máximo 40 caracteres")
  .regex(/^[a-z0-9._-]+$/, "Solo minúsculas, números, punto, guion y guion bajo");

export const userCreateSchema = z.object({
  username: usernameSchema,
  fullName: nameSchema,
  email: z.string().trim().email("Correo inválido").optional().or(z.literal("")),
  password: z.string().optional().or(z.literal("")),
  roleId: z.string().uuid("Elige un rol"),
  /** Vacío = todas las sucursales de la empresa. */
  branchIds: z.array(z.string().uuid()).default([]),
});
export const userUpdateSchema = z.object({
  fullName: nameSchema,
  email: z.string().trim().email("Correo inválido").optional().or(z.literal("")),
});
export const userAccessSchema = z.object({
  roleId: z.string().uuid("Elige un rol"),
  branchIds: z.array(z.string().uuid()).default([]),
});

export type UserRow = typeof users.$inferSelect;

export type UserListItem = {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  status: "active" | "disabled";
  isSuperadmin: boolean;
  lastLoginAt: Date | null;
  roleId: string | null;
  roleName: string | null;
  roleKey: string | null;
  branchIds: string[];
};

/** Usuarios con rol en la empresa activa (más los del tenant sin rol, si se pide). */
export async function listUsers(ctx: ServiceContext): Promise<UserListItem[]> {
  requirePermission(ctx, "users.view");
  const company = requireCompany(ctx);
  const rows = await db
    .select({
      user: users,
      roleId: roles.id,
      roleName: roles.name,
      roleKey: roles.key,
    })
    .from(users)
    .leftJoin(
      userCompanyRoles,
      and(eq(userCompanyRoles.userId, users.id), eq(userCompanyRoles.companyId, company.id)),
    )
    .leftJoin(roles, eq(roles.id, userCompanyRoles.roleId))
    .where(and(eq(users.tenantId, ctx.tenantId), eq(users.isSuperadmin, false)))
    .orderBy(asc(users.fullName));
  const ids = rows.map((r) => r.user.id);
  const branchRows = ids.length
    ? await db
        .select({ userId: userBranches.userId, branchId: userBranches.branchId })
        .from(userBranches)
        .innerJoin(branches, eq(branches.id, userBranches.branchId))
        .where(and(inArray(userBranches.userId, ids), eq(branches.companyId, company.id)))
    : [];
  const byUser = new Map<string, string[]>();
  for (const b of branchRows) (byUser.get(b.userId) ?? byUser.set(b.userId, []).get(b.userId)!).push(b.branchId);

  const canSeeAllBranches = ctx.permissions.has("branches.manage");
  const visible = new Set(ctx.branches.map((b) => b.id));
  return rows
    .map((r) => ({
      id: r.user.id,
      username: r.user.username,
      fullName: r.user.fullName,
      email: r.user.email,
      status: r.user.status,
      isSuperadmin: r.user.isSuperadmin,
      lastLoginAt: r.user.lastLoginAt,
      roleId: r.roleId,
      roleName: r.roleName,
      roleKey: r.roleKey,
      branchIds: byUser.get(r.user.id) ?? [],
    }))
    // Un gerente restringido solo ve usuarios de sus sucursales (o sin restricción).
    .filter((u) => canSeeAllBranches || u.branchIds.length === 0 || u.branchIds.some((b) => visible.has(b)));
}

export async function getUser(ctx: ServiceContext, userId: string): Promise<UserListItem> {
  const list = await listUsers(ctx);
  const found = list.find((u) => u.id === userId);
  if (!found) throw new NotFoundError("El usuario");
  return found;
}

/** Valida que el actor pueda delegar el rol y las sucursales solicitadas. */
async function assertDelegable(ctx: ServiceContext, roleId: string, branchIds: string[]) {
  const role = await getRole(ctx, roleId);
  if (role.key === "superadmin" || role.deactivatedAt) throw new NotFoundError("El rol");
  const missing = permissionsNotDelegable(ctx, role.permissions.filter(isPermission));
  if (missing.length) {
    throw new ForbiddenError(missing[0], `No puedes asignar el rol "${role.name}": incluye permisos que no tienes.`);
  }
  const visible = new Set(ctx.branches.map((b) => b.id));
  const canSeeAll = ctx.permissions.has("branches.manage");
  const company = requireCompany(ctx);
  if (branchIds.length) {
    const valid = await db
      .select({ id: branches.id })
      .from(branches)
      .where(and(inArray(branches.id, branchIds), eq(branches.companyId, company.id), isNull(branches.deactivatedAt)));
    if (valid.length !== branchIds.length) throw new NotFoundError("Alguna sucursal");
    if (!canSeeAll && branchIds.some((b) => !visible.has(b))) {
      throw new ForbiddenError("branches.manage", "No puedes asignar sucursales que no administras.");
    }
  } else if (!canSeeAll && visible.size > 0) {
    // Un gerente restringido no puede dar acceso a "todas" las sucursales.
    throw new ForbiddenError("branches.manage", "Debes elegir sucursales específicas dentro de tu alcance.");
  }
  return role;
}

async function syncBranches(conn: DbOrTx, ctx: ServiceContext, userId: string, branchIds: string[]) {
  const company = requireCompany(ctx);
  // Solo se tocan las asignaciones de sucursales de la empresa activa.
  const companyBranchIds = (
    await conn.select({ id: branches.id }).from(branches).where(eq(branches.companyId, company.id))
  ).map((b) => b.id);
  if (companyBranchIds.length) {
    await conn
      .delete(userBranches)
      .where(and(eq(userBranches.userId, userId), inArray(userBranches.branchId, companyBranchIds)));
  }
  if (branchIds.length) {
    await conn.insert(userBranches).values(
      branchIds.map((branchId) => ({ tenantId: ctx.tenantId, userId, branchId, createdBy: ctx.userId })),
    );
  }
}

export async function createUser(ctx: ServiceContext, raw: unknown) {
  requirePermission(ctx, "users.manage");
  const company = requireCompany(ctx);
  const input = parseOrThrow(userCreateSchema, raw);
  const role = await assertDelegable(ctx, input.roleId, input.branchIds);
  const password = input.password || generateTemporaryPassword();
  if (input.password) {
    const errors = passwordPolicyErrors(input.password);
    if (errors.length) throw new ValidationError({ password: errors });
  }
  const passwordHash = await hashPassword(password);

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, ctx.tenantId), sql`lower(${users.username}) = ${input.username}`))
    .limit(1);
  if (existing) throw new ValidationError({ username: ["Ese usuario ya existe."] });

  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        tenantId: ctx.tenantId,
        username: input.username,
        fullName: input.fullName,
        email: input.email || null,
        passwordHash,
        mustChangePassword: !input.password,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    await tx.insert(userCompanyRoles).values({
      tenantId: ctx.tenantId,
      userId: user.id,
      companyId: company.id,
      roleId: role.id,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    });
    await syncBranches(tx, ctx, user.id, input.branchIds);
    await recordAudit(tx, ctx.actor, {
      action: "users.create",
      entity: "user",
      entityId: user.id,
      after: { username: user.username, fullName: user.fullName, email: user.email, role: role.key, branchIds: input.branchIds },
    });
    return { user, temporaryPassword: input.password ? null : password };
  });
}

export async function updateUser(ctx: ServiceContext, userId: string, raw: unknown) {
  requirePermission(ctx, "users.manage");
  const input = parseOrThrow(userUpdateSchema, raw);
  const before = await getUser(ctx, userId);
  return db.transaction(async (tx) => {
    const [after] = await tx
      .update(users)
      .set({ fullName: input.fullName, email: input.email || null, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(and(eq(users.id, userId), eq(users.tenantId, ctx.tenantId)))
      .returning();
    await recordAudit(tx, ctx.actor, {
      action: "users.update",
      entity: "user",
      entityId: userId,
      before: { fullName: before.fullName, email: before.email },
      after: { fullName: after.fullName, email: after.email },
    });
    return after;
  });
}

/** Cambia rol y sucursales del usuario en la empresa activa. */
export async function setUserAccess(ctx: ServiceContext, userId: string, raw: unknown) {
  requirePermission(ctx, "users.manage");
  const company = requireCompany(ctx);
  const input = parseOrThrow(userAccessSchema, raw);
  if (userId === ctx.userId) throw new ConflictError("No puedes cambiar tu propio rol ni tus sucursales.");
  const before = await getUser(ctx, userId);
  const role = await assertDelegable(ctx, input.roleId, input.branchIds);
  if (before.roleKey === "owner" && role.key !== "owner") await assertNotLastOwner(ctx, userId);
  return db.transaction(async (tx) => {
    await tx
      .insert(userCompanyRoles)
      .values({ tenantId: ctx.tenantId, userId, companyId: company.id, roleId: role.id, createdBy: ctx.userId, updatedBy: ctx.userId })
      .onConflictDoUpdate({
        target: [userCompanyRoles.userId, userCompanyRoles.companyId],
        set: { roleId: role.id, updatedAt: new Date(), updatedBy: ctx.userId },
      });
    await syncBranches(tx, ctx, userId, input.branchIds);
    await recordAudit(tx, ctx.actor, {
      action: "users.access",
      entity: "user",
      entityId: userId,
      before: { role: before.roleKey, branchIds: before.branchIds },
      after: { role: role.key, branchIds: input.branchIds },
    });
  });
}

async function assertNotLastOwner(ctx: ServiceContext, userId: string) {
  const owners = await db
    .select({ userId: userCompanyRoles.userId })
    .from(userCompanyRoles)
    .innerJoin(roles, eq(roles.id, userCompanyRoles.roleId))
    .innerJoin(users, eq(users.id, userCompanyRoles.userId))
    .where(and(eq(userCompanyRoles.tenantId, ctx.tenantId), eq(roles.key, "owner"), eq(users.status, "active")))
    .groupBy(userCompanyRoles.userId);
  const otherOwners = owners.filter((o) => o.userId !== userId);
  if (otherOwners.length === 0) {
    throw new ConflictError("No puedes quitar al último dueño de la cuenta.");
  }
}

export async function setUserActive(ctx: ServiceContext, userId: string, active: boolean, reason?: string) {
  requirePermission(ctx, "users.manage");
  if (userId === ctx.userId) throw new ConflictError("No puedes desactivarte a ti mismo.");
  const before = await getUser(ctx, userId);
  if (!active && before.roleKey === "owner") await assertNotLastOwner(ctx, userId);
  return db.transaction(async (tx) => {
    await tx
      .update(users)
      .set(
        active
          ? { status: "active", deactivatedAt: null, deactivatedBy: null, updatedAt: new Date(), updatedBy: ctx.userId }
          : { status: "disabled", deactivatedAt: new Date(), deactivatedBy: ctx.userId, updatedAt: new Date(), updatedBy: ctx.userId },
      )
      .where(and(eq(users.id, userId), eq(users.tenantId, ctx.tenantId)));
    if (!active) await revokeAllUserSessions(userId, tx);
    await recordAudit(tx, ctx.actor, {
      action: active ? "users.activate" : "users.deactivate",
      entity: "user",
      entityId: userId,
      reason,
      before: { status: before.status },
      after: { status: active ? "active" : "disabled" },
    });
  });
}

/** Restablece contraseña con una temporal; revoca sesiones. */
export async function resetUserPassword(ctx: ServiceContext, userId: string) {
  requirePermission(ctx, "users.manage");
  const target = await getUser(ctx, userId);
  // No se puede restablecer la contraseña de alguien con más permisos (p. ej. un gerente al dueño).
  if (target.roleId) {
    const role = await getRole(ctx, target.roleId);
    if (permissionsNotDelegable(ctx, role.permissions.filter(isPermission)).length) {
      throw new ForbiddenError("users.manage", "No puedes restablecer la contraseña de un usuario con más permisos que tú.");
    }
  }
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, mustChangePassword: true, failedLoginAttempts: 0, lockedUntil: null, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(and(eq(users.id, userId), eq(users.tenantId, ctx.tenantId)));
    await revokeAllUserSessions(userId, tx);
    await recordAudit(tx, ctx.actor, {
      action: "users.reset_password",
      entity: "user",
      entityId: userId,
      after: { username: target.username },
    });
  });
  return { temporaryPassword };
}
