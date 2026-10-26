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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns } from "./common";
import { companies, tenants } from "./organization";
import { taxProfiles } from "./commerce-config";

/**
 * Importes en centavos (bigint, modo number: seguro hasta 9e15 centavos).
 * Cantidades en numeric(18,3) para admitir productos a granel.
 */
const money = (name: string) => bigint(name, { mode: "number" });
const qty = (name: string) => numeric(name, { precision: 18, scale: 3 });

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    color: text("color"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex("categories_company_name_idx").on(
      t.companyId,
      sql`coalesce(${t.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`lower(${t.name})`,
    ),
  ],
);

export const brands = pgTable(
  "brands",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    ...auditColumns,
  },
  (t) => [uniqueIndex("brands_company_name_idx").on(t.companyId, sql`lower(${t.name})`)],
);

export const unitsOfMeasure = pgTable(
  "units_of_measure",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    allowsDecimals: boolean("allows_decimals").notNull().default(false),
    /** Clave SAT (c_ClaveUnidad) para facturación, p. ej. H87 pieza, KGM kilogramo. */
    satCode: text("sat_code"),
    ...auditColumns,
  },
  (t) => [uniqueIndex("units_company_code_idx").on(t.companyId, t.code)],
);

export const PRODUCT_KINDS = ["simple", "variable"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    kind: text("kind").$type<ProductKind>().notNull().default("simple"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "restrict" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "restrict" }),
    unitId: uuid("unit_id").notNull().references(() => unitsOfMeasure.id, { onDelete: "restrict" }),
    taxProfileId: uuid("tax_profile_id").notNull().references(() => taxProfiles.id, { onDelete: "restrict" }),
    /** Nombres de atributos de las variantes, en orden: ["Talla", "Color"]. */
    attributeNames: text("attribute_names").array().notNull().default([]),
    trackStock: boolean("track_stock").notNull().default(true),
    isFavorite: boolean("is_favorite").notNull().default(false),
    /** Margen objetivo como fracción (0.35 = 35 %). */
    targetMargin: numeric("target_margin", { precision: 6, scale: 4 }),
    imageUrl: text("image_url"),
    /** Clave SAT de producto/servicio para facturación (c_ClaveProdServ). */
    satProductCode: text("sat_product_code"),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex("products_company_sku_idx").on(t.companyId, sql`lower(${t.sku})`),
    index("products_company_name_idx").on(t.companyId, t.name),
    index("products_category_idx").on(t.categoryId),
  ],
);

/**
 * Toda venta, precio e inventario apunta a una variante. Un producto simple
 * tiene exactamente una variante por defecto.
 */
export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
    sku: text("sku").notNull(),
    /** Texto de la combinación, p. ej. "M / Rojo". Vacío en productos simples. */
    variantName: text("variant_name").notNull().default(""),
    attributeValues: jsonb("attribute_values").$type<Record<string, string>>().notNull().default({}),
    /** Precio de venta en centavos (con o sin impuesto según el perfil). */
    price: money("price").notNull(),
    /** Costo unitario de referencia en centavos. Nulo = desconocido (la utilidad se marca incompleta). */
    cost: money("cost"),
    minStock: qty("min_stock"),
    maxStock: qty("max_stock"),
    reorderPoint: qty("reorder_point"),
    isDefault: boolean("is_default").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex("variants_company_sku_idx").on(t.companyId, sql`lower(${t.sku})`),
    index("variants_product_idx").on(t.productId),
  ],
);

export const barcodes = pgTable(
  "barcodes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex("barcodes_company_code_idx").on(t.companyId, t.code),
    index("barcodes_variant_idx").on(t.variantId),
  ],
);
