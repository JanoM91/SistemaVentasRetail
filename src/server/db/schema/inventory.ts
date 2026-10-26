import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { branches, companies, tenants, warehouses } from "./organization";
import { users } from "./identity";
import { productVariants } from "./catalog";

const money = (name: string) => bigint(name, { mode: "number" });
const qty = (name: string) => numeric(name, { precision: 18, scale: 3 });

/** Tipos de movimiento. Positivos = entradas, negativos = salidas (el signo va en quantity). */
export const MOVEMENT_TYPES = [
  "opening", //           existencia inicial
  "purchase_in", //       compra (F4)
  "adjustment_in", //     ajuste positivo
  "adjustment_out", //    ajuste negativo
  "shrinkage", //         merma
  "damaged", //           dañado
  "expired", //           caducado
  "sale_out", //          venta
  "sale_cancel_in", //    cancelación de venta (compensatorio)
  "return_in", //         devolución de cliente (F4)
  "transfer_out", //      traspaso salida (F4)
  "transfer_in", //       traspaso entrada (F4)
  "count_adjustment", //  ajuste por conteo físico (F4)
  "reversal", //          corrección compensatoria de otro movimiento
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/**
 * Libro de movimientos de inventario. INMUTABLE: un trigger en la base de
 * datos impide UPDATE y DELETE. Las correcciones se registran con un
 * movimiento `reversal` que apunta al original en `reverses_id`.
 */
export const inventoryLedger = pgTable(
  "inventory_ledger",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").notNull().references(() => branches.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "restrict" }),
    movementType: text("movement_type").$type<MovementType>().notNull(),
    /** Con signo: + entrada, − salida. */
    quantity: qty("quantity").notNull(),
    /** Costo unitario en centavos aplicado al movimiento (nulo si se desconoce). */
    unitCost: money("unit_cost"),
    totalCost: money("total_cost"),
    /** Existencia y costo promedio del almacén después del movimiento (para kardex). */
    balanceAfter: qty("balance_after").notNull(),
    avgCostAfter: money("avg_cost_after"),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    reversesId: uuid("reverses_id"),
    reason: text("reason"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("ledger_variant_wh_idx").on(t.warehouseId, t.variantId, t.createdAt),
    index("ledger_company_created_idx").on(t.companyId, t.createdAt),
    index("ledger_reference_idx").on(t.referenceType, t.referenceId),
    uniqueIndex("ledger_reverses_idx").on(t.reversesId).where(sql`${t.reversesId} is not null`),
  ],
);

/**
 * Saldo materializado por almacén y variante. Se actualiza en la misma
 * transacción que el libro; `scripts/verify-stock.ts` lo recalcula y compara.
 */
export const stockBalances = pgTable(
  "stock_balances",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").notNull().references(() => branches.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "restrict" }),
    onHand: qty("on_hand").notNull().default("0"),
    /** Costo promedio ponderado en centavos (nulo si nunca hubo costo). */
    avgCost: money("avg_cost"),
    lastMovementAt: timestamp("last_movement_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.warehouseId, t.variantId] }),
    index("stock_company_variant_idx").on(t.companyId, t.variantId),
  ],
);
