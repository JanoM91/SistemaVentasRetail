import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns, moduleKeyEnum, tenantStatusEnum } from "./common";

/** Dirección postal genérica (jsonb) */
export type Address = {
  street?: string;
  exteriorNumber?: string;
  interiorNumber?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

/** Cuenta cliente del SaaS. */
export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: tenantStatusEnum("status").notNull().default("active"),
    country: text("country").notNull().default("MX"),
    defaultCurrency: text("default_currency").notNull().default("MXN"),
    defaultTimezone: text("default_timezone")
      .notNull()
      .default("America/Mexico_City"),
    defaultLocale: text("default_locale").notNull().default("es-MX"),
    plan: text("plan").notNull().default("standard"),
    ...auditColumns,
  },
  (t) => [uniqueIndex("tenants_slug_idx").on(t.slug)],
);

export type CompanySettings = {
  inventory?: {
    costingMethod?: "average" | "fifo" | "manual";
    allowNegativeStock?: boolean;
  };
  promotions?: { allowStacking?: boolean; maxDiscountPercent?: number };
  invoicing?: { provider?: string; autoInvoice?: boolean };
  notifications?: { lowStockEmail?: string | null };
  pos?: { requireCustomerForCredit?: boolean; allowSaleWithoutCustomer?: boolean };
  /** Política de devoluciones (4C). */
  returns?: { maxDays?: number; allowWithoutTicket?: boolean; cashRefundNeedsAuthorization?: boolean };
};

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    legalName: text("legal_name").notNull(),
    tradeName: text("trade_name").notNull(),
    taxId: text("tax_id"),
    taxRegime: text("tax_regime"),
    currency: text("currency").notNull().default("MXN"),
    timezone: text("timezone").notNull().default("America/Mexico_City"),
    locale: text("locale").notNull().default("es-MX"),
    dateFormat: text("date_format").notNull().default("dd/MM/yyyy"),
    address: jsonb("address").$type<Address>().notNull().default({}),
    settings: jsonb("settings").$type<CompanySettings>().notNull().default({}),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex("companies_tenant_code_idx").on(t.tenantId, t.code),
    index("companies_tenant_idx").on(t.tenantId),
  ],
);

export const companyModules = pgTable(
  "company_modules",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    module: moduleKeyEnum("module").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    settings: jsonb("settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...auditColumns,
  },
  (t) => [primaryKey({ columns: [t.companyId, t.module] })],
);

export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    address: jsonb("address").$type<Address>().notNull().default({}),
    phone: text("phone"),
    email: text("email"),
    /** Si es nulo hereda la zona horaria de la empresa. */
    timezone: text("timezone"),
    settings: jsonb("settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex("branches_company_code_idx").on(t.companyId, t.code),
    index("branches_tenant_idx").on(t.tenantId),
  ],
);

export const warehouses = pgTable(
  "warehouses",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    allowsNegativeStock: boolean("allows_negative_stock")
      .notNull()
      .default(false),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex("warehouses_company_code_idx").on(t.companyId, t.code),
    uniqueIndex("warehouses_branch_default_idx")
      .on(t.branchId)
      .where(sql`${t.isDefault} = true`),
    index("warehouses_branch_idx").on(t.branchId),
  ],
);

export const cashRegisters = pgTable(
  "cash_registers",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    deviceId: text("device_id"),
    settings: jsonb("settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex("cash_registers_branch_code_idx").on(t.branchId, t.code),
    index("cash_registers_tenant_idx").on(t.tenantId),
  ],
);
