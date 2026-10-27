import { sql } from "drizzle-orm";
import { bigint, boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./common";
import { branches, companies, tenants } from "./organization";
import { users } from "./identity";
import { cashSessions, sales } from "./sales";
import { paymentMethods } from "./commerce-config";

const money = (name: string) => bigint(name, { mode: "number" });

/** Grupos de clientes (mayoreo, empleados, frecuentes…). En 4D se ligan a listas de precios. */
export const customerGroups = pgTable(
  "customer_groups",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    ...auditColumns,
  },
  (t) => [uniqueIndex("customer_groups_name_idx").on(t.companyId, sql`lower(${t.name})`)],
);

/**
 * Cliente. Los datos fiscales se guardan para la facturación (Fase 5).
 * `creditLimit` nulo = sin crédito. `creditBalance` y las estadísticas de
 * compra se mantienen en la misma transacción que la venta o el abono.
 */
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    birthday: date("birthday"),
    groupId: uuid("group_id").references(() => customerGroups.id, { onDelete: "set null" }),
    // Datos fiscales
    taxId: text("tax_id"),
    legalName: text("legal_name"),
    taxRegime: text("tax_regime"),
    cfdiUse: text("cfdi_use"),
    taxPostalCode: text("tax_postal_code"),
    address: jsonb("address").$type<Record<string, string | undefined>>().notNull().default({}),
    notes: text("notes"),
    marketingConsent: boolean("marketing_consent").notNull().default(false),
    marketingConsentAt: timestamp("marketing_consent_at", { withTimezone: true }),
    // Crédito
    creditLimit: money("credit_limit"),
    creditDays: integer("credit_days").notNull().default(30),
    creditBlocked: boolean("credit_blocked").notNull().default(false),
    creditBalance: money("credit_balance").notNull().default(0),
    // Estadísticas (ventas completadas)
    purchasesCount: integer("purchases_count").notNull().default(0),
    purchasesTotal: money("purchases_total").notNull().default(0),
    firstPurchaseAt: timestamp("first_purchase_at", { withTimezone: true }),
    lastPurchaseAt: timestamp("last_purchase_at", { withTimezone: true }),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex("customers_code_idx").on(t.companyId, t.code),
    index("customers_phone_idx").on(t.companyId, t.phone),
    index("customers_name_idx").on(t.companyId, t.name),
    index("customers_balance_idx").on(t.companyId).where(sql`${t.creditBalance} <> 0`),
  ],
);

export const CREDIT_MOVEMENT_KINDS = ["charge", "payment", "reversal", "adjustment", "return"] as const;
export type CreditMovementKind = (typeof CREDIT_MOVEMENT_KINDS)[number];

/**
 * Estado de cuenta del cliente. **Inmutable** (trigger en Postgres): las
 * correcciones son movimientos nuevos. `amount` positivo aumenta la deuda
 * (cargo por venta a crédito, ajuste a cargo) y negativo la reduce (abono,
 * reversa por cancelación, ajuste a favor).
 */
export const customerCreditMovements = pgTable(
  "customer_credit_movements",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").references(() => branches.id),
    kind: text("kind").$type<CreditMovementKind>().notNull(),
    amount: money("amount").notNull(),
    balanceAfter: money("balance_after").notNull(),
    /** Folio del abono (serie AB) o del documento que lo origina. */
    folio: text("folio"),
    saleId: uuid("sale_id").references(() => sales.id),
    paymentMethodId: uuid("payment_method_id").references(() => paymentMethods.id),
    paymentKind: text("payment_kind"),
    cashSessionId: uuid("cash_session_id").references(() => cashSessions.id),
    reference: text("reference"),
    /** Vencimiento de un cargo. */
    dueDate: date("due_date"),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    authorizedBy: uuid("authorized_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("credit_mov_customer_idx").on(t.customerId, t.createdAt),
    index("credit_mov_session_idx").on(t.cashSessionId),
    uniqueIndex("credit_mov_sale_kind_idx").on(t.saleId, t.kind).where(sql`${t.saleId} is not null`),
  ],
);
