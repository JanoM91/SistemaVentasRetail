import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns, userStatusEnum } from "./common";
import { branches, companies, tenants } from "./organization";

export type UserPreferences = {
  lastCompanyId?: string;
  lastBranchId?: string;
  theme?: "light" | "dark" | "system";
};

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    username: text("username").notNull(),
    email: text("email"),
    fullName: text("full_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    isSuperadmin: boolean("is_superadmin").notNull().default(false),
    status: userStatusEnum("status").notNull().default("active"),
    mustChangePassword: boolean("must_change_password")
      .notNull()
      .default(false),
    failedLoginAttempts: integer("failed_login_attempts")
      .notNull()
      .default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", {
      withTimezone: true,
    }),
    preferences: jsonb("preferences")
      .$type<UserPreferences>()
      .notNull()
      .default({}),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex("users_tenant_username_idx").on(
      t.tenantId,
      sql`lower(${t.username})`,
    ),
    uniqueIndex("users_tenant_email_idx")
      .on(t.tenantId, sql`lower(${t.email})`)
      .where(sql`${t.email} is not null`),
    index("users_tenant_idx").on(t.tenantId),
  ],
);

/**
 * Roles. Los del sistema tienen tenantId nulo y isSystem = true (plantillas).
 * permissions guarda códigos `modulo.accion` (ver src/server/authz/permissions.ts).
 */
export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").references(() => tenants.id, {
      onDelete: "restrict",
    }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    permissions: text("permissions").array().notNull().default([]),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex("roles_tenant_key_idx").on(
      sql`coalesce(${t.tenantId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.key,
    ),
  ],
);

export const userCompanyRoles = pgTable(
  "user_company_roles",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    ...auditColumns,
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.companyId] }),
    index("user_company_roles_company_idx").on(t.companyId),
  ],
);

/** Sin filas para un usuario = acceso a todas las sucursales de sus empresas. */
export const userBranches = pgTable(
  "user_branches",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    createdBy: uuid("created_by"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.branchId] })],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp("absolute_expires_at", {
      withTimezone: true,
    }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    deviceId: text("device_id"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    activeCompanyId: uuid("active_company_id").references(() => companies.id),
    activeBranchId: uuid("active_branch_id").references(() => branches.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_idx").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId, t.expiresAt),
  ],
);
