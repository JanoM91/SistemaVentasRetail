import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./common";
import { companies, tenants } from "./organization";
import { productVariants } from "./catalog";
import { sales } from "./sales";
import { customers } from "./customers";
import type { PromotionKind } from "@/lib/promotions";

const money = (name: string) => bigint(name, { mode: "number" });

/** Regla de promoción. El cálculo vive en `src/lib/promotions.ts` (compartido con el POS). */
export const promotions = pgTable(
  "promotions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    kind: text("kind").$type<PromotionKind>().notNull(),
    percent: numeric("percent", { precision: 5, scale: 2 }),
    amount: money("amount"),
    buyQty: integer("buy_qty"),
    payQty: integer("pay_qty"),
    tiers: jsonb("tiers").$type<Array<{ minQty: number; percent: number }>>(),
    bundle: jsonb("bundle").$type<Array<{ variantId: string; qty: number }>>(),
    bundlePrice: money("bundle_price"),
    scope: text("scope").$type<"all" | "categories" | "products">().notNull().default("all"),
    categoryIds: jsonb("category_ids").$type<string[]>().notNull().default([]),
    productIds: jsonb("product_ids").$type<string[]>().notNull().default([]),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    daysOfWeek: jsonb("days_of_week").$type<number[]>().notNull().default([]),
    timeFrom: text("time_from"),
    timeTo: text("time_to"),
    branchIds: jsonb("branch_ids").$type<string[]>().notNull().default([]),
    customerGroupIds: jsonb("customer_group_ids").$type<string[]>().notNull().default([]),
    requiresCoupon: boolean("requires_coupon").notNull().default(false),
    minPurchase: money("min_purchase"),
    maxUses: integer("max_uses"),
    maxUsesPerCustomer: integer("max_uses_per_customer"),
    priority: integer("priority").notNull().default(0),
    stackable: boolean("stackable").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    ...auditColumns,
  },
  (t) => [index("promotions_company_idx").on(t.companyId, t.isActive)],
);

/** Cupón: código que desbloquea una promoción marcada como «requiere cupón». */
export const coupons = pgTable(
  "coupons",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    promotionId: uuid("promotion_id").notNull().references(() => promotions.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    maxUses: integer("max_uses"),
    usedCount: integer("used_count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    ...auditColumns,
  },
  (t) => [uniqueIndex("coupons_code_idx").on(t.companyId, sql`upper(${t.code})`)],
);

/** Uso de una promoción en una venta (para límites, reportes y reversa al cancelar). */
export const promotionRedemptions = pgTable(
  "promotion_redemptions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    promotionId: uuid("promotion_id").notNull().references(() => promotions.id, { onDelete: "restrict" }),
    couponId: uuid("coupon_id").references(() => coupons.id),
    saleId: uuid("sale_id").notNull().references(() => sales.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id").references(() => customers.id),
    amount: money("amount").notNull(),
    description: text("description").notNull(),
    status: text("status").$type<"applied" | "reversed">().notNull().default("applied"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("promo_redemptions_promo_idx").on(t.promotionId, t.status), index("promo_redemptions_sale_idx").on(t.saleId)],
);

/**
 * Lista de precios (mayoreo, empleados…). Se asigna a grupos de clientes.
 * Precio fijo por variante o, si no lo tiene, el precio base ajustado por
 * `adjustmentPercent` (−10 = 10 % menos).
 */
export const priceLists = pgTable(
  "price_lists",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    adjustmentPercent: numeric("adjustment_percent", { precision: 6, scale: 2 }),
    isActive: boolean("is_active").notNull().default(true),
    ...auditColumns,
  },
  (t) => [uniqueIndex("price_lists_name_idx").on(t.companyId, sql`lower(${t.name})`)],
);

export const priceListItems = pgTable(
  "price_list_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    priceListId: uuid("price_list_id").notNull().references(() => priceLists.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "cascade" }),
    price: money("price").notNull(),
  },
  (t) => [uniqueIndex("price_list_items_unique_idx").on(t.priceListId, t.variantId)],
);
