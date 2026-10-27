import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { branches, cashRegisters, companies, tenants, warehouses } from "./organization";
import { users } from "./identity";
import { paymentMethods } from "./commerce-config";
import { productVariants } from "./catalog";
import { inventoryLedger } from "./inventory";
import { cashSessions, saleLines, sales } from "./sales";
import { customers } from "./customers";

const money = (name: string) => bigint(name, { mode: "number" });
const qty = (name: string) => numeric(name, { precision: 18, scale: 3 });

export const RETURN_REASONS = ["defective", "wrong_item", "changed_mind", "expired", "other"] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];
export const REFUND_METHODS = ["cash", "original", "customer_account", "store_credit"] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

/**
 * Devolución de cliente (con o sin ticket). Se registra en un turno de caja.
 * Con `refundMethod = store_credit` genera un vale (folio de la devolución)
 * cuyo saldo se canjea como pago en ventas posteriores; así funcionan los
 * cambios de producto.
 */
export const saleReturns = pgTable(
  "sale_returns",
  {
    /** UUID generado por el POS (reenviar no duplica). */
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").notNull().references(() => branches.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "restrict" }),
    cashRegisterId: uuid("cash_register_id").notNull().references(() => cashRegisters.id, { onDelete: "restrict" }),
    cashSessionId: uuid("cash_session_id").notNull().references(() => cashSessions.id, { onDelete: "restrict" }),
    saleId: uuid("sale_id").references(() => sales.id),
    customerId: uuid("customer_id").references(() => customers.id),
    series: text("series").notNull(),
    number: integer("number").notNull(),
    folio: text("folio").notNull(),
    reasonCode: text("reason_code").$type<ReturnReason>().notNull(),
    reason: text("reason").notNull(),
    subtotal: money("subtotal").notNull(),
    taxTotal: money("tax_total").notNull(),
    total: money("total").notNull(),
    /** Costo de lo devuelto (nulo si alguna línea no tiene costo). */
    costTotal: money("cost_total"),
    refundMethod: text("refund_method").$type<RefundMethod>().notNull(),
    refundPaymentMethodId: uuid("refund_payment_method_id").references(() => paymentMethods.id),
    refundReference: text("refund_reference"),
    /** Saldo disponible del vale (solo `store_credit`). */
    storeCreditBalance: money("store_credit_balance").notNull().default(0),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    authorizedBy: uuid("authorized_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("sale_returns_folio_idx").on(t.branchId, t.series, t.number),
    index("sale_returns_sale_idx").on(t.saleId),
    index("sale_returns_session_idx").on(t.cashSessionId),
    index("sale_returns_company_idx").on(t.companyId, t.createdAt),
  ],
);

export const saleReturnLines = pgTable(
  "sale_return_lines",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    returnId: uuid("return_id").notNull().references(() => saleReturns.id, { onDelete: "restrict" }),
    saleLineId: uuid("sale_line_id").references(() => saleLines.id),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "restrict" }),
    sku: text("sku").notNull(),
    description: text("description").notNull(),
    quantity: qty("quantity").notNull(),
    netAmount: money("net_amount").notNull(),
    taxAmount: money("tax_amount").notNull(),
    lineTotal: money("line_total").notNull(),
    unitCost: money("unit_cost"),
    /** true = regresa al inventario vendible; false = merma (dañado, caducado). */
    restock: boolean("restock").notNull(),
    ledgerId: uuid("ledger_id").references(() => inventoryLedger.id),
  },
  (t) => [index("sale_return_lines_return_idx").on(t.returnId), index("sale_return_lines_sale_line_idx").on(t.saleLineId)],
);

/** Canje de vales en ventas. Si la venta se cancela, el canje se revierte y el vale recupera su saldo. */
export const storeCreditRedemptions = pgTable(
  "store_credit_redemptions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    returnId: uuid("return_id").notNull().references(() => saleReturns.id, { onDelete: "restrict" }),
    saleId: uuid("sale_id").notNull().references(() => sales.id, { onDelete: "restrict" }),
    amount: money("amount").notNull(),
    status: text("status").$type<"applied" | "reversed">().notNull().default("applied"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("store_credit_redemptions_return_idx").on(t.returnId), index("store_credit_redemptions_sale_idx").on(t.saleId)],
);
