import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { branches, cashRegisters, companies, tenants, warehouses } from "./organization";
import { users } from "./identity";
import { paymentMethods, salesChannels, type PaymentKind } from "./commerce-config";
import { productVariants } from "./catalog";
import { customers } from "./customers";

const money = (name: string) => bigint(name, { mode: "number" });
const qty = (name: string) => numeric(name, { precision: 18, scale: 3 });

// ---------------------------------------------------------------- Caja

export type Denominations = Record<string, number>; // "50000" (centavos) → piezas

export type CashSummary = {
  salesCount: number;
  salesTotal: number;
  cancelledCount: number;
  cancelledTotal: number;
  byMethod: Array<{ methodId: string; name: string; kind: PaymentKind; amount: number; count: number }>;
  cashSales: number;
  /** Devoluciones del turno: reembolsado por forma (opcional en cortes anteriores a 4C). */
  refunds?: { count: number; total: number; cash: number; original: number; customerAccount: number; storeCredit: number };
  /** Abonos de clientes recibidos en el turno, por método (opcional en cortes anteriores a 4B). */
  creditPayments?: Array<{ methodId: string; name: string; kind: PaymentKind; amount: number; count: number }>;
  cashCreditPayments?: number;
  deposits: number;
  withdrawals: number;
  expectedCash: number;
};

export const cashSessions = pgTable(
  "cash_sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").notNull().references(() => branches.id, { onDelete: "restrict" }),
    cashRegisterId: uuid("cash_register_id").notNull().references(() => cashRegisters.id, { onDelete: "restrict" }),
    status: text("status").$type<"open" | "closed">().notNull().default("open"),
    openedBy: uuid("opened_by").notNull().references(() => users.id),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().default(sql`now()`),
    openingAmount: money("opening_amount").notNull().default(0),
    closedBy: uuid("closed_by").references(() => users.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    expectedCash: money("expected_cash"),
    countedCash: money("counted_cash"),
    difference: money("difference"),
    denominations: jsonb("denominations").$type<Denominations>(),
    closingSummary: jsonb("closing_summary").$type<CashSummary>(),
    notes: text("notes"),
  },
  (t) => [
    uniqueIndex("cash_sessions_one_open_idx").on(t.cashRegisterId).where(sql`${t.status} = 'open'`),
    index("cash_sessions_branch_idx").on(t.branchId, t.openedAt),
  ],
);

export const cashMovements = pgTable(
  "cash_movements",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    cashSessionId: uuid("cash_session_id").notNull().references(() => cashSessions.id, { onDelete: "restrict" }),
    kind: text("kind").$type<"withdrawal" | "deposit">().notNull(),
    amount: money("amount").notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    authorizedBy: uuid("authorized_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("cash_movements_session_idx").on(t.cashSessionId)],
);

// ---------------------------------------------------------------- Ventas

export type SaleFlag = {
  code: "price_changed" | "negative_stock" | "session_closed" | "variant_inactive" | "late_sync" | "discount_unauthorized" | "customer_missing" | "promotion_mismatch";
  detail: string;
};

export const sales = pgTable(
  "sales",
  {
    /** UUID generado por el cliente (idempotencia en sincronización offline). */
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").notNull().references(() => branches.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "restrict" }),
    cashRegisterId: uuid("cash_register_id").notNull().references(() => cashRegisters.id, { onDelete: "restrict" }),
    cashSessionId: uuid("cash_session_id").notNull().references(() => cashSessions.id, { onDelete: "restrict" }),
    channelId: uuid("channel_id").references(() => salesChannels.id),
    series: text("series").notNull(),
    number: integer("number").notNull(),
    folio: text("folio").notNull(),
    status: text("status").$type<"completed" | "cancelled">().notNull().default("completed"),
    currency: text("currency").notNull(),
    subtotal: money("subtotal").notNull(),
    discountTotal: money("discount_total").notNull().default(0),
    taxTotal: money("tax_total").notNull(),
    total: money("total").notNull(),
    paidTotal: money("paid_total").notNull(),
    changeAmount: money("change_amount").notNull().default(0),
    /** Costo total de lo vendido; nulo si alguna línea no tiene costo (utilidad incompleta). */
    costTotal: money("cost_total"),
    customerId: uuid("customer_id").references(() => customers.id),
    customerName: text("customer_name"),
    notes: text("notes"),
    soldBy: uuid("sold_by").notNull().references(() => users.id),
    /** Momento de la venta según el dispositivo (relevante en ventas offline). */
    soldAt: timestamp("sold_at", { withTimezone: true }).notNull(),
    origin: text("origin").$type<"online" | "offline">().notNull().default("online"),
    deviceId: text("device_id"),
    clientSequence: integer("client_sequence"),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    flags: jsonb("flags").$type<SaleFlag[]>().notNull().default([]),
    discountAuthorizedBy: uuid("discount_authorized_by").references(() => users.id),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelAuthorizedBy: uuid("cancel_authorized_by").references(() => users.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    /** Revisión de una venta con observaciones (pantalla de revisión, 4D). */
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewNote: text("review_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("sales_folio_idx").on(t.branchId, t.series, t.number),
    index("sales_session_idx").on(t.cashSessionId),
    index("sales_branch_sold_idx").on(t.branchId, t.soldAt),
    index("sales_customer_idx").on(t.customerId, t.soldAt),
  ],
);

export const saleLines = pgTable(
  "sale_lines",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    saleId: uuid("sale_id").notNull().references(() => sales.id, { onDelete: "restrict" }),
    lineNo: integer("line_no").notNull(),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "restrict" }),
    sku: text("sku").notNull(),
    description: text("description").notNull(),
    quantity: qty("quantity").notNull(),
    /** Precio unitario cobrado (centavos), en la base del perfil de impuesto. */
    unitPrice: money("unit_price").notNull(),
    /** Precio de catálogo al momento de vender (para detectar cambios). */
    listPrice: money("list_price").notNull(),
    discountAmount: money("discount_amount").notNull().default(0),
    /** Parte del descuento que viene de promociones (el resto es manual). */
    promotionDiscount: money("promotion_discount").notNull().default(0),
    taxRate: numeric("tax_rate", { precision: 9, scale: 6 }).notNull(),
    taxIncluded: boolean("tax_included").notNull().default(true),
    taxAmount: money("tax_amount").notNull(),
    netAmount: money("net_amount").notNull(),
    lineTotal: money("line_total").notNull(),
    unitCost: money("unit_cost"),
  },
  (t) => [index("sale_lines_sale_idx").on(t.saleId), index("sale_lines_variant_idx").on(t.variantId)],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    saleId: uuid("sale_id").notNull().references(() => sales.id, { onDelete: "restrict" }),
    paymentMethodId: uuid("payment_method_id").notNull().references(() => paymentMethods.id),
    kind: text("kind").$type<PaymentKind>().notNull(),
    /** Importe aplicado a la venta (sin el cambio). */
    amount: money("amount").notNull(),
    /** Lo que entregó el cliente (efectivo) y el cambio devuelto. */
    received: money("received"),
    change: money("change").notNull().default(0),
    reference: text("reference"),
    status: text("status").$type<"approved" | "refunded">().notNull().default("approved"),
    provider: text("provider").notNull().default("manual"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("payments_sale_idx").on(t.saleId)],
);

/** Registro de cada elemento recibido por sincronización (auditoría de offline). */
export const syncEvents = pgTable(
  "sync_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").references(() => companies.id),
    branchId: uuid("branch_id").references(() => branches.id),
    userId: uuid("user_id").references(() => users.id),
    deviceId: text("device_id"),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    status: text("status").$type<"applied" | "duplicate" | "conflict" | "rejected">().notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("sync_events_tenant_idx").on(t.tenantId, t.status, t.createdAt)],
);
