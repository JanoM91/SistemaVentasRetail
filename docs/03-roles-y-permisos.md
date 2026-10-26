# 03 · Roles y permisos

Versión 0.1 · 2026-10-26

## 1. Modelo

- Un **permiso** es un código `modulo.accion` (por ejemplo `pos.discount`). El catálogo de permisos vive en código (`src/server/authz/permissions.ts`) y es la única fuente de verdad; la interfaz y el backend lo consumen.
- Un **rol** es un conjunto de permisos. Hay roles del sistema (plantillas, no editables) y roles personalizados por tenant (copiados de una plantilla y ajustados).
- Un **usuario** pertenece a un tenant y recibe **un rol por empresa** (`user_company_roles`). Opcionalmente se le restringe a ciertas **sucursales** (`user_branches`); sin restricción, ve todas las sucursales de la empresa.
- El **superadministrador** es un atributo del usuario a nivel plataforma (`users.is_superadmin`), no un rol por empresa. Sus acciones sobre datos de negocio quedan en bitácora con la marca `impersonated = false, platform = true`.
- Los **módulos activables** por empresa filtran los permisos efectivos: si el módulo `promotions` está apagado, `promotions.*` no se concede a nadie en esa empresa aunque el rol lo tenga.

Permiso efectivo = permisos del rol en la empresa ∩ módulos activos en la empresa, evaluado siempre en el servidor. El frontend usa la misma lista solo para ocultar botones.

## 2. Catálogo de permisos

| Módulo | Permiso | Qué permite |
| --- | --- | --- |
| platform | `platform.tenants.manage` | Crear, editar, suspender tenants; activar módulos para cualquier empresa. Solo superadministrador. |
| settings | `settings.view` / `settings.manage` | Ver / cambiar configuración regional, impuestos, folios, métodos de pago, canales, parámetros, notificaciones y módulos activos de la empresa. |
| companies | `companies.view` / `companies.manage` | Ver / crear, editar, desactivar empresas del tenant. |
| branches | `branches.view` / `branches.manage` | Ver / crear, editar, desactivar sucursales, almacenes, ubicaciones y cajas. |
| users | `users.view` / `users.manage` | Ver / crear, editar, desactivar usuarios, asignar roles y sucursales, restablecer contraseñas. |
| roles | `roles.view` / `roles.manage` | Ver / crear y editar roles personalizados. |
| audit | `audit.view` | Consultar y exportar la bitácora. |
| catalog | `catalog.view`, `catalog.create`, `catalog.edit`, `catalog.disable`, `catalog.edit_price`, `catalog.view_cost`, `catalog.import` | Productos, variantes, categorías, marcas, unidades, códigos. |
| inventory | `inventory.view`, `inventory.adjust`, `inventory.transfer`, `inventory.count`, `inventory.authorize`, `inventory.view_cost` | Movimientos, traspasos, conteos y autorización de ajustes. |
| pos | `pos.sell`, `pos.discount`, `pos.edit_price`, `pos.cancel`, `pos.reopen`, `pos.reprint`, `pos.credit_sale`, `pos.quote` | Operación del punto de venta. |
| cash | `cash.open`, `cash.close`, `cash.withdraw`, `cash.deposit`, `cash.view_differences`, `cash.close_any` | Caja y turnos; `close_any` permite cerrar la caja de otro usuario. |
| purchases | `purchases.view`, `purchases.create`, `purchases.authorize`, `purchases.receive`, `purchases.return` | Compras y proveedores. |
| customers | `customers.view`, `customers.manage`, `customers.export`, `customers.credit_manage` | CRM, segmentos y límites de crédito. |
| promotions | `promotions.view`, `promotions.manage` | Promociones, cupones y listas de precios. |
| returns | `returns.create`, `returns.authorize`, `returns.no_ticket` | Devoluciones y cambios. |
| invoicing | `invoicing.view`, `invoicing.issue`, `invoicing.cancel` | Facturación electrónica. |
| reports | `reports.view`, `reports.view_profit`, `reports.export`, `reports.schedule` | Reportes; `view_profit` controla costos, márgenes y utilidades. |
| channels | `channels.view`, `channels.manage`, `orders.manage` | Canales de venta y pedidos omnicanal. |
| loyalty | `loyalty.view`, `loyalty.manage` | Puntos, tarjetas de regalo, saldo prepago. |
| credit | `credit.view`, `credit.manage` | Cuentas por cobrar de clientes. |

## 3. Roles del sistema

| Rol | Clave | Alcance | Permisos |
| --- | --- | --- | --- |
| Superadministrador | `superadmin` | Plataforma | Todos, incluidos `platform.*`. Se asigna por atributo, no por empresa. |
| Dueño | `owner` | Todas las empresas del tenant | Todos excepto `platform.*`. |
| Gerente | `manager` | Empresa y sucursales asignadas | Todo lo operativo: `branches.view`, `users.view`, `users.manage` (limitado, ver reglas), `audit.view`, `settings.view`, `catalog.*`, `inventory.*`, `pos.*`, `cash.*`, `purchases.*`, `customers.*`, `promotions.*`, `returns.*`, `invoicing.*`, `reports.view`, `reports.view_profit`, `reports.export`, `channels.*`, `orders.manage`, `loyalty.*`, `credit.*`. No tiene `branches.manage`, `companies.manage`, `roles.manage`, `settings.manage`, `reports.schedule`. |
| Cajero | `cashier` | Sucursales asignadas | `catalog.view`, `inventory.view`, `pos.sell`, `pos.quote`, `cash.open`, `cash.close`, `cash.withdraw`, `cash.deposit`, `customers.view`, `customers.manage`, `returns.create`, `invoicing.issue`, `loyalty.view`, `credit.view`. No ve costos ni utilidades; descuentos, cancelaciones, reimpresiones y devoluciones requieren autorización de alguien con el permiso. |

## 4. Reglas transversales

1. **Jerarquía de delegación**: un usuario solo puede otorgar permisos que él mismo tiene y solo en sucursales que puede ver. El servidor lo valida (`users.manage` no basta).
2. **Último dueño**: no se puede desactivar ni degradar al último usuario con rol `owner` de un tenant.
3. **Autoprotección**: nadie puede desactivarse, cambiarse el rol ni quitarse sucursales a sí mismo.
4. **Autorización en caliente**: acciones como descuento, cancelación, reapertura, reimpresión y devolución piden credenciales de un autorizador con el permiso; se registra quién ejecutó y quién autorizó.
5. **Bitácora obligatoria**: toda acción de los módulos `platform`, `companies`, `branches`, `users`, `roles`, `settings` y toda acción con `authorize`, `cancel`, `reopen`, `adjust`, `close`, `withdraw`, `issue` escribe en `audit_log` con datos anteriores y nuevos.
6. **Aislamiento**: todas las consultas incluyen `tenant_id`; las tablas de negocio incluyen además `company_id`. Un identificador de otro tenant produce "no encontrado", nunca "sin permiso", para no revelar existencia.
7. **Sesiones**: expiran por inactividad (configurable, 12 h por defecto) y de forma absoluta (30 días); cambiar contraseña o desactivar usuario revoca todas sus sesiones.

## 5. Matriz resumida (F2)

| Acción | Superadmin | Dueño | Gerente | Cajero |
| --- | --- | --- | --- | --- |
| Crear tenant | ✔ | — | — | — |
| Crear/editar empresa | ✔ | ✔ | — | — |
| Activar módulos | ✔ | ✔ | — | — |
| Crear sucursal/almacén/caja | ✔ | ✔ | — | — |
| Ver sucursales | ✔ | ✔ | ✔ | ✔ (las suyas) |
| Crear usuario | ✔ | ✔ | ✔ (≤ su rol, sus sucursales) | — |
| Crear rol personalizado | ✔ | ✔ | — | — |
| Ver bitácora | ✔ | ✔ | ✔ (sus sucursales) | — |
| Cambiar configuración regional | ✔ | ✔ | — | — |
