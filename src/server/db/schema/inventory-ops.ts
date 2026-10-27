import { sql } from "drizzle-orm";
import { bigint, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { branches, companies, tenants, warehouses } from "./organization";
import { users } from "./identity";
import { productVariants } from "./catalog";
import { inventoryLedger } from "./inventory";

const money = (name: string) => bigint(name, { mode: "number" });
const qty = (name: string) => numeric(name, { precision: 18, scale: 3 });

// ---------------------------------------------------------------- Traspasos

/**
 * Traspaso entre almacenes (misma o distinta sucursal). Al enviarse sale del
 * origen y queda "en tránsito"; al recibirse entra al destino con lo que
 * realmente llegó. Cancelar un envío regresa la mercancía al origen.
 */
export const stockTransfers = pgTable(
  "stock_transfers",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    folio: text("folio").notNull(),
    fromWarehouseId: uuid("from_warehouse_id").notNull().references(() => warehouses.id, { onDelete: "restrict" }),
    toWarehouseId: uuid("to_warehouse_id").notNull().references(() => warehouses.id, { onDelete: "restrict" }),
    fromBranchId: uuid("from_branch_id").notNull().references(() => branches.id, { onDelete: "restrict" }),
    toBranchId: uuid("to_branch_id").notNull().references(() => branches.id, { onDelete: "restrict" }),
    status: text("status").$type<"in_transit" | "received" | "cancelled">().notNull().default("in_transit"),
    notes: text("notes"),
    sentBy: uuid("sent_by").notNull().references(() => users.id),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().default(sql`now()`),
    receivedBy: uuid("received_by").references(() => users.id),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    receiveNotes: text("receive_notes"),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
  },
  (t) => [uniqueIndex("stock_transfers_folio_idx").on(t.companyId, t.folio), index("stock_transfers_status_idx").on(t.companyId, t.status)],
);

export const stockTransferLines = pgTable(
  "stock_transfer_lines",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    transferId: uuid("transfer_id").notNull().references(() => stockTransfers.id, { onDelete: "restrict" }),
    lineNo: integer("line_no").notNull(),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "restrict" }),
    quantitySent: qty("quantity_sent").notNull(),
    quantityReceived: qty("quantity_received"),
    /** Costo unitario con que salió del origen (promedio vigente). */
    unitCost: money("unit_cost"),
    outLedgerId: uuid("out_ledger_id").references(() => inventoryLedger.id),
    inLedgerId: uuid("in_ledger_id").references(() => inventoryLedger.id),
  },
  (t) => [index("transfer_lines_transfer_idx").on(t.transferId)],
);

// ---------------------------------------------------------------- Conteos físicos

/**
 * Conteo físico. Cada línea guarda la existencia del sistema en el momento en
 * que se captura lo contado, para que las ventas durante el conteo no generen
 * diferencias falsas. Al aplicarse, cada diferencia se registra como
 * movimiento `count_adjustment` en el libro.
 */
export const stockCounts = pgTable(
  "stock_counts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").notNull().references(() => branches.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "restrict" }),
    folio: text("folio").notNull(),
    status: text("status").$type<"open" | "applied" | "cancelled">().notNull().default("open"),
    /** Alcance: todo el almacén o una categoría. */
    categoryId: uuid("category_id"),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    appliedBy: uuid("applied_by").references(() => users.id),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("stock_counts_folio_idx").on(t.companyId, t.folio)],
);

export const stockCountLines = pgTable(
  "stock_count_lines",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    countId: uuid("count_id").notNull().references(() => stockCounts.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "restrict" }),
    /** Existencia del sistema al momento de capturar lo contado. */
    systemQty: qty("system_qty"),
    countedQty: qty("counted_qty"),
    countedBy: uuid("counted_by").references(() => users.id),
    countedAt: timestamp("counted_at", { withTimezone: true }),
    ledgerId: uuid("ledger_id").references(() => inventoryLedger.id),
  },
  (t) => [uniqueIndex("count_lines_unique_idx").on(t.countId, t.variantId)],
);
