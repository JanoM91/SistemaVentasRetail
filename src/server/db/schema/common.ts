import { sql } from "drizzle-orm";
import { pgEnum, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Columnas de auditoría comunes. La desactivación lógica (deactivatedAt)
 * es la vía normal; nunca se borran registros del núcleo.
 */
export const auditColumns = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  deactivatedBy: uuid("deactivated_by"),
};

export const tenantStatusEnum = pgEnum("tenant_status", [
  "active",
  "suspended",
]);

export const userStatusEnum = pgEnum("user_status", ["active", "disabled"]);

/** Módulos activables por empresa. La clave es estable: se usa en permisos y navegación. */
export const MODULE_KEYS = [
  "catalog",
  "inventory",
  "pos",
  "purchases",
  "customers",
  "promotions",
  "returns",
  "invoicing",
  "reports",
  "channels",
  "loyalty",
  "credit",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const moduleKeyEnum = pgEnum("module_key", MODULE_KEYS);
