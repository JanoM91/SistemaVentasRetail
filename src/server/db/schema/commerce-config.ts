import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns } from "./common";
import { branches, cashRegisters, companies, tenants } from "./organization";

/** Catálogo global de monedas (ISO 4217). */
export const currencies = pgTable("currencies", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  minorUnit: integer("minor_unit").notNull().default(2),
});

export const TAX_KINDS = ["iva", "ieps", "retencion", "otro"] as const;
export type TaxKind = (typeof TAX_KINDS)[number];

/** Perfiles de impuesto por empresa. La tasa es decimal (0.16 = 16 %). */
export const taxProfiles = pgTable(
  "tax_profiles",
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
    kind: text("kind").$type<TaxKind>().notNull().default("iva"),
    rate: numeric("rate", { precision: 9, scale: 6 }).notNull().default("0"),
    isIncludedInPrice: boolean("is_included_in_price").notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),
    countryRules: jsonb("country_rules")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...auditColumns,
  },
  (t) => [uniqueIndex("tax_profiles_company_code_idx").on(t.companyId, t.code)],
);

export const DOCUMENT_TYPES = [
  "sale",
  "quote",
  "return",
  "purchase",
  "transfer",
  "invoice",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Series y folios por empresa / sucursal / caja y tipo de documento. */
export const documentSequences = pgTable(
  "document_sequences",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").references(() => branches.id),
    cashRegisterId: uuid("cash_register_id").references(() => cashRegisters.id),
    documentType: text("document_type").$type<DocumentType>().notNull(),
    series: text("series").notNull().default(""),
    nextNumber: integer("next_number").notNull().default(1),
    padding: integer("padding").notNull().default(6),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex("document_sequences_scope_idx").on(
      t.companyId,
      sql`coalesce(${t.branchId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`coalesce(${t.cashRegisterId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.documentType,
      t.series,
    ),
  ],
);

export const PAYMENT_KINDS = [
  "cash",
  "card_credit",
  "card_debit",
  "transfer",
  "qr",
  "wallet",
  "terminal",
  "customer_credit",
  "gift_card",
  "prepaid",
  "coupon",
  "points",
  "financing",
] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const paymentMethods = pgTable(
  "payment_methods",
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
    kind: text("kind").$type<PaymentKind>().notNull(),
    /** Adaptador de proveedor (`manual`, `sandbox`, nombre del proveedor). */
    provider: text("provider").notNull().default("manual"),
    requiresReference: boolean("requires_reference").notNull().default(false),
    opensDrawer: boolean("opens_drawer").notNull().default(false),
    allowsChange: boolean("allows_change").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    settings: jsonb("settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex("payment_methods_company_code_idx").on(t.companyId, t.code),
    index("payment_methods_company_idx").on(t.companyId),
  ],
);

export const CHANNEL_KINDS = [
  "store",
  "ecommerce",
  "whatsapp",
  "social",
  "phone",
  "manual",
  "marketplace",
] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

export const salesChannels = pgTable(
  "sales_channels",
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
    kind: text("kind").$type<ChannelKind>().notNull().default("store"),
    provider: text("provider").notNull().default("manual"),
    isActive: boolean("is_active").notNull().default(true),
    settings: jsonb("settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...auditColumns,
  },
  (t) => [uniqueIndex("sales_channels_company_code_idx").on(t.companyId, t.code)],
);
