import { ForbiddenError } from "@/server/errors";
import type { ModuleKey } from "@/server/db/schema/common";
import { moduleForArea, permissionArea, type Permission } from "./permissions";

export type HasPermissions = { permissions: Set<Permission> };

export function hasPermission(ctx: HasPermissions, permission: Permission): boolean {
  return ctx.permissions.has(permission);
}

export function hasAnyPermission(ctx: HasPermissions, perms: readonly Permission[]): boolean {
  return perms.some((p) => ctx.permissions.has(p));
}

/** Lanza ForbiddenError si falta el permiso. Úsalo en toda acción y consulta. */
export function requirePermission(ctx: HasPermissions, permission: Permission): void {
  if (!ctx.permissions.has(permission)) throw new ForbiddenError(permission);
}

export function requireAnyPermission(ctx: HasPermissions, perms: readonly Permission[]): void {
  if (!hasAnyPermission(ctx, perms)) throw new ForbiddenError(perms[0]);
}

/**
 * Regla de delegación: solo se pueden otorgar permisos que uno mismo tiene.
 * Devuelve los permisos que el otorgante NO posee. Si se pasa el conjunto de
 * módulos activos, los permisos de módulos apagados no cuentan (nadie los
 * tiene de forma efectiva, así que no hay escalada posible).
 */
export function permissionsNotDelegable(
  grantor: HasPermissions & { enabledModules?: Set<ModuleKey> },
  wanted: readonly Permission[],
): Permission[] {
  const mods = grantor.enabledModules;
  return wanted.filter((p) => {
    if (mods) {
      const mod = moduleForArea(permissionArea(p));
      if (mod !== null && !mods.has(mod)) return false;
    }
    return !grantor.permissions.has(p);
  });
}
