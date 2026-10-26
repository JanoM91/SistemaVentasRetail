import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, type DbOrTx } from "@/server/db";
import {
  branches,
  companies,
  companyModules,
  roles,
  userBranches,
  userCompanyRoles,
  users,
  type ModuleKey,
} from "@/server/db/schema";
import {
  ALL_PERMISSIONS,
  isPermission,
  moduleForArea,
  permissionArea,
  type Permission,
} from "./permissions";

export type Membership = {
  companyId: string;
  companyCode: string;
  companyName: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  permissions: Permission[];
};

export type BranchSummary = { id: string; code: string; name: string };

export type AuthzContext = {
  tenantId: string;
  userId: string;
  isSuperadmin: boolean;
  memberships: Membership[];
  company: typeof companies.$inferSelect | null;
  branch: BranchSummary | null;
  /** Sucursales accesibles en la empresa activa. */
  branches: BranchSummary[];
  roleKey: string | null;
  enabledModules: Set<ModuleKey>;
  /** Permisos efectivos = rol ∩ módulos activos (más plataforma si superadmin). */
  permissions: Set<Permission>;
};

export async function listMemberships(
  conn: DbOrTx,
  userId: string,
  tenantId: string,
): Promise<Membership[]> {
  const rows = await conn
    .select({
      companyId: companies.id,
      companyCode: companies.code,
      companyName: companies.tradeName,
      roleId: roles.id,
      roleKey: roles.key,
      roleName: roles.name,
      permissions: roles.permissions,
    })
    .from(userCompanyRoles)
    .innerJoin(companies, eq(companies.id, userCompanyRoles.companyId))
    .innerJoin(roles, eq(roles.id, userCompanyRoles.roleId))
    .where(
      and(
        eq(userCompanyRoles.userId, userId),
        eq(userCompanyRoles.tenantId, tenantId),
        eq(companies.tenantId, tenantId),
        isNull(companies.deactivatedAt),
        isNull(roles.deactivatedAt),
      ),
    )
    .orderBy(companies.tradeName);
  return rows.map((r) => ({
    ...r,
    permissions: r.permissions.filter(isPermission),
  }));
}

export async function listEnabledModules(
  conn: DbOrTx,
  companyId: string,
): Promise<Set<ModuleKey>> {
  const rows = await conn
    .select({ module: companyModules.module })
    .from(companyModules)
    .where(and(eq(companyModules.companyId, companyId), eq(companyModules.enabled, true)));
  return new Set(rows.map((r) => r.module));
}

export async function listAccessibleBranches(
  conn: DbOrTx,
  userId: string,
  companyId: string,
): Promise<BranchSummary[]> {
  const restricted = await conn
    .select({ branchId: userBranches.branchId })
    .from(userBranches)
    .where(eq(userBranches.userId, userId));
  const where = [eq(branches.companyId, companyId), isNull(branches.deactivatedAt)];
  if (restricted.length > 0) {
    where.push(
      inArray(
        branches.id,
        restricted.map((r) => r.branchId),
      ),
    );
  }
  return conn
    .select({ id: branches.id, code: branches.code, name: branches.name })
    .from(branches)
    .where(and(...where))
    .orderBy(branches.name);
}

/** Calcula los permisos efectivos de un rol dentro de una empresa. */
export function effectivePermissions(
  rolePermissions: readonly Permission[],
  enabledModules: Set<ModuleKey>,
  isSuperadmin: boolean,
): Set<Permission> {
  const out = new Set<Permission>();
  for (const p of rolePermissions) {
    const mod = moduleForArea(permissionArea(p));
    if (mod === null || enabledModules.has(mod)) out.add(p);
  }
  if (isSuperadmin) {
    for (const p of ALL_PERMISSIONS) {
      if (permissionArea(p) === "platform") out.add(p);
    }
  }
  return out;
}

/**
 * Resuelve el contexto de autorización para un usuario, empresa y sucursal.
 * Si la empresa o sucursal solicitadas no son accesibles, se elige la primera disponible.
 */
export async function resolveAuthz(
  input: {
    userId: string;
    tenantId: string;
    isSuperadmin: boolean;
    requestedCompanyId?: string | null;
    requestedBranchId?: string | null;
  },
  conn: DbOrTx = db,
): Promise<AuthzContext> {
  const memberships = await listMemberships(conn, input.userId, input.tenantId);
  const membership =
    memberships.find((m) => m.companyId === input.requestedCompanyId) ?? memberships[0] ?? null;

  let company: typeof companies.$inferSelect | null = null;
  let branchList: BranchSummary[] = [];
  let enabledModules = new Set<ModuleKey>();
  if (membership) {
    [company] = await conn
      .select()
      .from(companies)
      .where(eq(companies.id, membership.companyId))
      .limit(1);
    enabledModules = await listEnabledModules(conn, membership.companyId);
    branchList = await listAccessibleBranches(conn, input.userId, membership.companyId);
  }
  const branch =
    branchList.find((b) => b.id === input.requestedBranchId) ?? branchList[0] ?? null;

  return {
    tenantId: input.tenantId,
    userId: input.userId,
    isSuperadmin: input.isSuperadmin,
    memberships,
    company: company ?? null,
    branch,
    branches: branchList,
    roleKey: membership?.roleKey ?? null,
    enabledModules,
    permissions: effectivePermissions(
      membership?.permissions ?? [],
      enabledModules,
      input.isSuperadmin,
    ),
  };
}

export type UserRow = typeof users.$inferSelect;
