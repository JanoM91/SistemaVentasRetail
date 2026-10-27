import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
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
import { auditColumns } from "./common";
import { branches, companies, tenants, warehouses, type Address } from "./organization";
import { users } from "./identity";
import { products, productVariants } from "./catalog";
import { inventoryLedger } from "./inventory";

const money = (name: string) => bigint(name, { mode: "number" });
const qty = (name: string) => numeric(name, { precision: 18, scale: 3 });

// ---------------------------------------------------------------- Proveedores

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    legalName: text("legal_name"),
    taxId: text("tax_id"),
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    address: jsonb("address").$type<Address>().notNull().default({}),
    /** Días de crédito que otorga el proveedor (0 = contado). */
    paymentTermsDays: integer("payment_terms_days").notNull().default(0),
    /** Días promedio de entrega (para sugerencias de compra). */
    leadTimeDays: integer("lead_time_days").notNull().default(7),
    notes: text("notes"),
    ...auditColumns,
  },
  (t) => [uniqueIndex("suppliers_company_code_idx").on(t.companyId, t.code)],
);

/** Proveedores de cada producto (principal y alternativos) con su último costo. */
export const productSuppliers = pgTable(
  "product_suppliers",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "restrict" }),
    isPrimary: boolean("is_primary").notNull().default(false),
    supplierSku: text("supplier_sku"),
    lastCost: money("last_cost"),
    lastPurchaseAt: timestamp("last_purchase_at", { withTimezone: true }),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex("product_suppliers_unique_idx").on(t.productId, t.supplierId),
    uniqueIndex("product_suppliers_primary_idx").on(t.productId).where(sql`${t.isPrimary} = true`),
  ],
);

// ---------------------------------------------------------------- Órdenes de compra

export type PurchaseOrderStatus = "draft" | "sent" | "partial" | "received" | "cancelled";

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").notNull().references(() => branches.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "restrict" }),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "restrict" }),
    folio: text("folio").notNull(),
    status: text("status").$type<PurchaseOrderStatus>().notNull().default("draft"),
    expectedAt: date("expected_at"),
    notes: text("notes"),
    /** Estimado (costos netos × cantidades pedidas). */
    subtotal: money("subtotal").notNull().default(0),
    taxTotal: money("tax_total").notNull().default(0),
    total: money("total").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentBy: uuid("sent_by").references(() => users.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex("purchase_orders_folio_idx").on(t.companyId, t.folio),
    index("purchase_orders_supplier_idx").on(t.supplierId),
  ],
);

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "restrict" }),
    lineNo: integer("line_no").notNull(),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "restrict" }),
    quantityOrdered: qty("quantity_ordered").notNull(),
    quantityReceived: qty("quantity_received").notNull().default("0"),
    /** Costo unitario neto (sin IVA) en centavos. */
    unitCost: money("unit_cost").notNull(),
    taxRate: numeric("tax_rate", { precision: 9, scale: 6 }).notNull().default("0"),
  },
  (t) => [index("po_lines_po_idx").on(t.purchaseOrderId)],
);

// ---------------------------------------------------------------- Recepciones (compras)

export const purchaseReceipts = pgTable(
  "purchase_receipts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").notNull().references(() => branches.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "restrict" }),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "restrict" }),
    /** Nulo = compra directa sin orden. */
    purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id, { onDelete: "restrict" }),
    folio: text("folio").notNull(),
    supplierInvoice: text("supplier_invoice"),
    invoiceDate: date("invoice_date"),
    /** Mercancía (neto), costos adicionales (flete, maniobras…), impuestos y total a pagar. */
    subtotal: money("subtotal").notNull(),
    extraCosts: money("extra_costs").notNull().default(0),
    extraCostsDetail: jsonb("extra_costs_detail").$type<Array<{ concept: string; amount: number }>>().notNull().default([]),
    taxTotal: money("tax_total").notNull(),
    total: money("total").notNull(),
    notes: text("notes"),
    receivedBy: uuid("received_by").notNull().references(() => users.id),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("purchase_receipts_folio_idx").on(t.companyId, t.folio),
    index("purchase_receipts_supplier_idx").on(t.supplierId, t.receivedAt),
  ],
);

export const purchaseReceiptLines = pgTable(
  "purchase_receipt_lines",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    receiptId: uuid("receipt_id").notNull().references(() => purchaseReceipts.id, { onDelete: "restrict" }),
    purchaseOrderLineId: uuid("purchase_order_line_id").references(() => purchaseOrderLines.id),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "restrict" }),
    quantity: qty("quantity").notNull(),
    /** Costo unitario neto facturado. */
    unitCost: money("unit_cost").notNull(),
    /** Costo unitario con costos adicionales prorrateados (el que entra al inventario). */
    landedUnitCost: money("landed_unit_cost").notNull(),
    taxRate: numeric("tax_rate", { precision: 9, scale: 6 }).notNull().default("0"),
    ledgerId: uuid("ledger_id").references(() => inventoryLedger.id),
  },
  (t) => [index("receipt_lines_receipt_idx").on(t.receiptId), index("receipt_lines_variant_idx").on(t.variantId)],
);

// ---------------------------------------------------------------- Devoluciones a proveedor

export const supplierReturns = pgTable(
  "supplier_returns",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").notNull().references(() => branches.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "restrict" }),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "restrict" }),
    receiptId: uuid("receipt_id").references(() => purchaseReceipts.id),
    folio: text("folio").notNull(),
    reason: text("reason").notNull(),
    /** Importe a favor (nota de crédito) con impuestos. */
    creditAmount: money("credit_amount").notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [uniqueIndex("supplier_returns_folio_idx").on(t.companyId, t.folio)],
);

export const supplierReturnLines = pgTable("supplier_return_lines", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
  supplierReturnId: uuid("supplier_return_id").notNull().references(() => supplierReturns.id, { onDelete: "restrict" }),
  variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "restrict" }),
  quantity: qty("quantity").notNull(),
  unitCost: money("unit_cost").notNull(),
  taxRate: numeric("tax_rate", { precision: 9, scale: 6 }).notNull().default("0"),
  ledgerId: uuid("ledger_id").references(() => inventoryLedger.id),
});

// ---------------------------------------------------------------- Cuentas por pagar

/** Una cuenta por pagar por recepción de compra. El saldo se deriva de sus movimientos. */
export const payables = pgTable(
  "payables",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "restrict" }),
    receiptId: uuid("receipt_id").notNull().references(() => purchaseReceipts.id, { onDelete: "restrict" }),
    amount: money("amount").notNull(),
    balance: money("balance").notNull(),
    dueDate: date("due_date").notNull(),
    status: text("status").$type<"open" | "paid">().notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [uniqueIndex("payables_receipt_idx").on(t.receiptId), index("payables_supplier_idx").on(t.supplierId, t.status)],
);

export const payablePayments = pgTable(
  "payable_payments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    payableId: uuid("payable_id").notNull().references(() => payables.id, { onDelete: "restrict" }),
    kind: text("kind").$type<"payment" | "credit_note">().notNull().default("payment"),
    amount: money("amount").notNull(),
    method: text("method").notNull(),
    reference: text("reference"),
    supplierReturnId: uuid("supplier_return_id").references(() => supplierReturns.id),
    paidAt: date("paid_at").notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("payable_payments_payable_idx").on(t.payableId)],
);
