# 05 · Modelo de datos

Versión 0.1 · 2026-10-26

Convenciones: tablas en `snake_case` plural; `id uuid` primario; `tenant_id` en todas las tablas de negocio; `company_id` en todas las tablas operativas; columnas de auditoría `created_at`, `updated_at`, `created_by`, `updated_by`, `deactivated_at`, `deactivated_by` (desactivación en lugar de borrado); dinero en `bigint` centavos; fechas en `timestamptz`. Columnas marcadas **F2** existen en la migración inicial; el resto se agrega en la fase indicada.

## 1. Plataforma y organización (F2)

| Tabla | Columnas principales | Claves y notas |
| --- | --- | --- |
| `tenants` | `id`, `name`, `slug`, `status` (active/suspended), `country`, `default_currency`, `default_timezone`, `default_locale`, `plan`, auditoría | `slug` único. Un tenant = una cuenta cliente del SaaS. |
| `companies` | `id`, `tenant_id`, `code`, `legal_name`, `trade_name`, `tax_id` (RFC), `tax_regime`, `currency`, `timezone`, `locale`, `date_format`, `address` (jsonb), `settings` (jsonb), auditoría | Única `(tenant_id, code)`. `settings`: parámetros de inventario, promociones, facturación, notificaciones. |
| `company_modules` | `company_id`, `module` (enum), `enabled`, `settings` (jsonb), auditoría | PK `(company_id, module)`. Módulos: catalog, inventory, pos, purchases, customers, promotions, returns, invoicing, reports, channels, loyalty, credit. |
| `branches` | `id`, `tenant_id`, `company_id`, `code`, `name`, `address` (jsonb), `phone`, `email`, `timezone` (nullable, hereda), `settings` (jsonb), auditoría | Única `(company_id, code)`. |
| `warehouses` | `id`, `tenant_id`, `company_id`, `branch_id`, `code`, `name`, `is_default`, `allows_negative_stock`, auditoría | Única `(company_id, code)`. Un `is_default` por sucursal (índice parcial). |
| `locations` | `id`, `tenant_id`, `warehouse_id`, `code`, `name`, `kind` (shelf/bin/zone/transit) | Única `(warehouse_id, code)`. F3. |
| `cash_registers` | `id`, `tenant_id`, `company_id`, `branch_id`, `code`, `name`, `device_id` (nullable), `settings` (jsonb), auditoría | Única `(branch_id, code)`. Cajas/terminales. |
| `users` | `id`, `tenant_id`, `username`, `email` (nullable), `full_name`, `password_hash`, `is_superadmin`, `status`, `failed_login_attempts`, `locked_until`, `last_login_at`, `password_changed_at`, `preferences` (jsonb), auditoría | Única `(tenant_id, username)`; `email` única por tenant cuando no es nulo. |
| `roles` | `id`, `tenant_id` (nullable para roles del sistema), `key`, `name`, `description`, `is_system`, `permissions` (text[]), auditoría | Única `(tenant_id, key)`. Roles del sistema: `tenant_id` nulo. |
| `user_company_roles` | `user_id`, `company_id`, `role_id`, `tenant_id`, auditoría | PK `(user_id, company_id)`. Un rol por empresa. |
| `user_branches` | `user_id`, `branch_id`, `tenant_id` | PK `(user_id, branch_id)`. Sin filas = todas las sucursales de las empresas donde tiene rol. |
| `sessions` | `id`, `tenant_id`, `user_id`, `token_hash`, `expires_at`, `absolute_expires_at`, `ip`, `user_agent`, `device_id`, `last_seen_at`, `revoked_at`, `active_company_id`, `active_branch_id`, `created_at` | Índice `token_hash` único. |
| `audit_log` | `id`, `tenant_id`, `company_id`, `branch_id`, `user_id`, `authorized_by_user_id`, `session_id`, `action` (texto `modulo.accion`), `entity`, `entity_id`, `reason`, `before` (jsonb), `after` (jsonb), `ip`, `user_agent`, `device_id`, `created_at` | Solo inserción. Índices por `(tenant_id, created_at)`, `(entity, entity_id)`, `(user_id)`. |
| `notifications` | `id`, `tenant_id`, `company_id`, `user_id` (nullable), `kind`, `title`, `body`, `data` (jsonb), `read_at`, `created_at` | F2 estructura; emisión en F3+. |

## 2. Configuración comercial (F2 estructura mínima; uso en F3)

| Tabla | Columnas principales | Notas |
| --- | --- | --- |
| `currencies` | `code` (ISO), `name`, `symbol`, `minor_unit` | Catálogo global. |
| `company_currencies` | `company_id`, `currency_code`, `is_base`, `exchange_rate` (numeric), `updated_at` | |
| `tax_profiles` | `id`, `company_id`, `code`, `name`, `kind` (iva/ieps/retencion/otro), `rate` (numeric 9,6), `is_included_in_price`, `country_rules` (jsonb) | Ejemplo MX: IVA 16 %, IVA 8 % frontera, IVA 0 %, exento, IEPS. |
| `document_sequences` | `id`, `company_id`, `branch_id` (nullable), `cash_register_id` (nullable), `document_type` (sale/quote/return/purchase/transfer/invoice), `series`, `next_number`, `padding` | Única `(company_id, branch_id, cash_register_id, document_type, series)`. |
| `payment_methods` | `id`, `company_id`, `code`, `name`, `kind` (cash/card_credit/card_debit/transfer/qr/wallet/terminal/customer_credit/gift_card/prepaid/coupon/points/financing), `provider` (adaptador), `requires_reference`, `opens_drawer`, `allows_change`, `is_active`, `settings` (jsonb) | |
| `sales_channels` | `id`, `company_id`, `code`, `name`, `kind` (store/ecommerce/whatsapp/social/phone/manual/marketplace), `provider`, `settings` (jsonb), `is_active` | |
| `price_lists` | `id`, `company_id`, `code`, `name`, `currency`, `priority`, `valid_from`, `valid_to`, `is_default` | |

## 3. Catálogo (F3)

`categories` (árbol por `parent_id`), `brands`, `units_of_measure` (+ `unit_conversions`), `product_attributes` y `product_attribute_values` (talla, color…), `products` (`sku`, `name`, `kind` simple/variable, `category_id`, `brand_id`, `unit_id`, `tax_profile_id`, `base_price`, `base_cost`, `target_margin`, `track_lots`, `track_expiry`, `track_serials`, `images` jsonb, `attributes` jsonb, `main_supplier_id`), `product_variants` (`product_id`, `sku`, `name`, `attribute_values` jsonb, `price`, `cost`, `image`, `weight`, `dimensions`), `barcodes` (`variant_id`, `code`, `kind`; única `(company_id, code)`), `product_suppliers`, `product_relations` (related/substitute), `price_list_items` (`price_list_id`, `variant_id`, `price`, `min_qty`), `stock_policies` (`variant_id`, `branch_id`/`warehouse_id`, `min_qty`, `max_qty`, `reorder_point`, `lead_time_days`).

Regla: todo producto simple tiene exactamente una variante por defecto; el inventario, los precios y las ventas siempre apuntan a `product_variants`.

## 4. Inventario y costos (F3)

| Tabla | Propósito |
| --- | --- |
| `inventory_ledger` | **Inmutable.** `id`, `company_id`, `branch_id`, `warehouse_id`, `location_id`, `variant_id`, `lot_id`, `serial_id`, `movement_type` (purchase_in, sale_out, return_in, supplier_return_out, adjustment_in/out, transfer_out, transfer_in, count_adjustment, shrinkage, damaged, expired, reservation, release, opening), `quantity` (numeric 18,6; positivo entrada, negativo salida), `unit_cost`, `total_cost`, `reference_type`, `reference_id`, `reverses_ledger_id`, `reason`, `created_by`, `created_at`, `client_id` (idempotencia offline). Sin `updated_at`. |
| `stock_balances` | Saldo materializado por `(warehouse_id, location_id, variant_id, lot_id)`: `on_hand`, `reserved`, `available` (generada), `avg_cost`, `last_movement_at`. Se actualiza en la misma transacción que el ledger; un job de verificación recalcula desde el ledger. |
| `stock_lots` | `variant_id`, `lot_number`, `expires_at`, `received_at`, `unit_cost`. |
| `stock_serials` | `variant_id`, `serial_number`, `status`, `warehouse_id`. |
| `stock_reservations` | `variant_id`, `warehouse_id`, `quantity`, `reference` (pedido/cotización), `expires_at`, `released_at`. |
| `stock_transfers` + `stock_transfer_lines` | **Implementado (4A).** Origen y destino (almacén y sucursal), estado `in_transit`/`received`/`cancelled`, cantidad enviada y recibida, costo de salida y liga a los dos movimientos del libro. |
| `stock_counts` + `stock_count_lines` | **Implementado (4A).** Alcance (almacén o categoría), estado `open`/`applied`/`cancelled`; cada línea guarda la existencia del sistema al momento de capturar, lo contado y el movimiento de ajuste. |
| `cost_layers` | Capas FIFO por `(warehouse_id, variant_id)`: `quantity_remaining`, `unit_cost`, `ledger_id`. Solo cuando el método de costeo es FIFO. |

## 5. Compras (F4 · implementado en 4A)

| Tabla | Propósito |
| --- | --- |
| `suppliers` | Clave única por empresa, datos fiscales y de contacto, dirección, `payment_terms_days` (crédito), `lead_time_days` (entrega, usado por sugerencias). |
| `product_suppliers` | Producto ↔ proveedor; un proveedor principal por producto (índice parcial único); `last_cost` y `last_purchase_at` se actualizan en cada recepción. |
| `purchase_orders` + `purchase_order_lines` | Estado `draft` → `sent` → `partial` → `received` (o `cancelled`); folio `OC` por empresa; costo neto y tasa de IVA por línea; cantidad pedida y recibida. |
| `purchase_receipts` + `purchase_receipt_lines` | Entrada de mercancía (de una orden o compra directa con `purchase_order_id` nulo); factura y fecha; `extra_costs` con detalle en JSON; por línea `unit_cost` y `landed_unit_cost` (con cargos prorrateados por valor) y liga al libro. Folio `RC`. |
| `supplier_returns` + `supplier_return_lines` | Devolución a proveedor (folio `DP`): salida `supplier_return_out` al costo de la compra o promedio; `credit_amount` con IVA. |
| `payables` + `payable_payments` | Una cuenta por recepción con importe, saldo, vencimiento y estado; movimientos `payment` o `credit_note` (ligado a la devolución). |

El historial de precios del proveedor se obtiene de `purchase_receipt_lines` (no hay tabla separada). Los folios de documentos de empresa (`OC`, `RC`, `DP`, `TR`, `CF`) usan `document_sequences` con `branch_id` nulo.

## 6. Ventas y caja (F3 base; F4 completa)

| Tabla | Propósito |
| --- | --- |
| `cash_sessions` | Turno de caja: `cash_register_id`, `opened_by`, `opened_at`, `opening_amount`, `closed_by`, `closed_at`, `expected_amount`, `counted_amount`, `difference`, `status`, `denominations` jsonb. |
| `cash_movements` | Retiros y depósitos con motivo, ligados a `cash_session_id`. |
| `sales` | `id` (uuid cliente u origen), `company_id`, `branch_id`, `cash_register_id`, `cash_session_id`, `channel_id`, `customer_id`, `series`, `number`, `status` (draft/suspended/quote/completed/cancelled/returned), `kind` (sale/quote), `currency`, `exchange_rate`, `subtotal`, `discount_total`, `tax_total`, `total`, `paid_total`, `change_amount`, `price_list_id`, `notes`, `sold_by`, `authorized_by`, `cancel_reason`, `origin` (online/offline), `client_sequence`, `synced_at`, auditoría. Única `(company_id, branch_id, series, number)`. |
| `sale_lines` | `variant_id`, `description`, `quantity`, `unit_price`, `unit_cost` (congelado), `discount_amount`, `tax_amount`, `line_total`, `promotion_id`, `promotion_explanation`, `returned_quantity`, `lot_id`, `serial_id`. |
| `payments` | `sale_id`, `return_id`, `payment_method_id`, `amount`, `currency`, `reference`, `status` (pending/approved/declined/refunded), `provider`, `provider_payload` jsonb (sin datos de tarjeta), `reconciled_at`, `created_by`. |
| `returns` + `return_lines` | Devoluciones/cambios: origen, motivo, `restock` bool, reembolso (método original/crédito en tienda), autorizado por. |
| `credit_accounts` + `credit_movements` | Límite, saldo, movimientos (cargo por venta, abono, ajuste), vencimientos. |

## 7. Clientes, promociones y lealtad (F4)

`customers` (datos, `tax_profile` jsonb para facturar, `consents` jsonb, `tags` text[], `preferred_branch_id`, `credit_account_id`, `loyalty_account_id`), `customer_addresses`, `customer_segments` (manual/automático con `rules` jsonb y `members` materializados en `customer_segment_members`), `promotions` (tipo, `rules` jsonb, `benefits` jsonb, vigencia, horarios, días, sucursales, canales, segmentos, límites, exclusiones, `stackable`, `priority`), `coupons` (código, `promotion_id`, usos, límite por cliente), `promotion_usages`, `loyalty_programs`, `loyalty_accounts`, `loyalty_movements`, `gift_cards` + `gift_card_movements`.

## 8. Canales, facturación y sincronización (F5 salvo sync en F3)

`channel_orders` (estado del pedido unificado, `external_id`, `payload` jsonb, `sale_id` cuando se convierte), `channel_order_events`, `invoices` (`sale_id`, `provider`, `uuid_fiscal`, `status` draft/stamped/cancelled/sandbox, `xml_url`, `pdf_url`, `error`), `sync_queue` (`device_id`, `entity`, `entity_id`, `payload`, `status`, `attempts`, `last_error`, `received_at`, `applied_at`), `error_log`, `jobs` (cola interna), `integration_tokens` (API externa, hash).

## 9. Diagrama de relaciones (núcleo F2)

```
tenants 1─n companies 1─n branches 1─n warehouses 1─n locations
   │             │             └─n cash_registers
   │             └─n company_modules
   ├─n users n─1 roles (por company via user_company_roles)
   │     └─n user_branches ─ branches
   │     └─n sessions
   └─n audit_log
```

## 10. Índices y restricciones clave (F2)

- `users (tenant_id, username)` único; `users (tenant_id, lower(email))` único parcial `where email is not null`.
- `sessions (token_hash)` único; `sessions (user_id, expires_at)`.
- `warehouses (branch_id) where is_default` único parcial.
- `audit_log (tenant_id, created_at desc)`, `audit_log (tenant_id, entity, entity_id)`.
- Claves foráneas con `on delete restrict` en todo el núcleo; la desactivación lógica es la vía normal.
