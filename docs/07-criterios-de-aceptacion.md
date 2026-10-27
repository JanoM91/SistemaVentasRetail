# 07 · Criterios de aceptación

Versión 0.1 · 2026-10-26

Cada criterio se verifica con una prueba automatizada (U = unitaria, I = integración con Postgres, E = extremo a extremo) o con un procedimiento manual documentado (M). La columna "Fase" indica cuándo queda cubierto.

## Fase 2 (esta entrega)

| # | Criterio | Verificación | Estado |
| --- | --- | --- | --- |
| AC-01 | Un superadministrador puede crear un tenant con empresa, sucursal, almacén, caja y usuario dueño iniciales. | I: `tests/integration/platform.test.ts` | Cubierto |
| AC-02 | Un dueño puede crear una empresa, una sucursal, un almacén y un usuario desde la interfaz. | I: `admin.test.ts`; M: guía de demo | Cubierto |
| AC-03 | El inicio de sesión funciona con usuario y contraseña; contraseñas incorrectas no revelan si el usuario existe; 5 fallos bloquean 15 minutos. | I: `auth.test.ts` | Cubierto |
| AC-04 | La sesión se guarda en base de datos como hash; la cookie es httpOnly; cerrar sesión la revoca; desactivar al usuario revoca todas sus sesiones. | I: `auth.test.ts` | Cubierto |
| AC-05 | Los permisos impiden acciones no autorizadas en el servidor aunque se invoque la acción directamente. | U: `permissions.test.ts`; I: `authz.test.ts` | Cubierto |
| AC-06 | Un usuario de un tenant no puede leer ni modificar datos de otro tenant; el intento responde "no encontrado". | I: `isolation.test.ts` | Cubierto |
| AC-07 | Un gerente no puede otorgar permisos que no tiene ni asignar sucursales que no ve; no se puede desactivar al último dueño ni a uno mismo. | I: `users.test.ts` | Cubierto |
| AC-08 | Toda acción crítica queda en bitácora con usuario, fecha, sucursal, dispositivo, motivo y datos anteriores/nuevos; la bitácora no es editable desde la aplicación. | I: `audit.test.ts` | Cubierto |
| AC-09 | Los módulos desactivados desaparecen de la navegación y sus permisos no se conceden. | U: `permissions.test.ts`; M | Cubierto |
| AC-10 | La aplicación compila (`npm run build`), pasa lint y las pruebas (`npm test`) sin errores. | CI local | Cubierto |
| AC-11 | Existen README, `.env.example`, migraciones, semillas con datos de prueba y credenciales de demostración. | M | Cubierto |
| AC-12 | No hay botones principales sin funcionalidad en las pantallas de la fase. | M: revisión de pantallas | Cubierto |
| AC-13 | La interfaz está en español, funciona en computadora, tableta y celular y ofrece modo claro/oscuro. | M | Cubierto |

## Fase 3 (entregada el 2026-10-26)

| # | Criterio | Verificación | Estado |
| --- | --- | --- | --- |
| AC-20 | Un gerente registra productos simples y con variantes, con SKU, códigos de barras, costos y existencia inicial. | I: `phase3.test.ts` › catálogo; E: `pos.mjs` (alta de «Café molido») | Cubierto |
| AC-21 | Un cajero vende escaneando, buscando o tocando productos, con variantes y cantidades a granel. | I: `phase3.test.ts` › AC-21/22; E: `pos.mjs` | Cubierto |
| AC-22 | El inventario se descuenta automáticamente; el libro es inmutable (trigger en Postgres) y las correcciones generan movimientos compensatorios. | I: `phase3.test.ts` › inventario y AC-22; `npm run stock:verify` | Cubierto |
| AC-23 | Se vende sin internet (incluso recargando la página) y se sincroniza sin duplicados: reenvíos y envíos simultáneos de la misma venta producen una sola. | I: `phase3.test.ts` › AC-23 (×2); E: `pos.mjs` › sin conexión y sincronización | Cubierto |
| AC-24 | Apertura con fondo, retiros, depósitos, corte X, corte Z por denominación con diferencia registrada; cancelación autorizada que regresa inventario y efectivo. | I: `phase3.test.ts` › AC-24; E: `pos.mjs` › corte Z | Cubierto |
| AC-25 | Ticket en pantalla, imprimible en 80 mm y reimprimible; ticket provisional para ventas sin conexión. | E: `pos.mjs` (folio en ticket, ticket pendiente); ruta `/ticket/[id]` | Cubierto |

## Fase 4

Se entrega en cuatro bloques (4A compras e inventario avanzado · 4B clientes, crédito y pagos divididos · 4C devoluciones y cambios · 4D promociones y listas de precios).

| # | Criterio | Verificación | Estado |
| --- | --- | --- | --- |
| AC-34 | Órdenes de compra con borrador, envío autorizado, recepción parcial o total que actualiza el costo promedio con flete prorrateado; compra directa; devolución a proveedor con nota de crédito; cuentas por pagar con pagos parciales. | I: `phase4a.test.ts` (5 casos); E: `compras.mjs` | Cubierto (4A) |
| AC-34a | Traspasos entre sucursales con mercancía en tránsito; solo el destino recibe; los faltantes quedan en bitácora; cancelar regresa al origen. | I: `phase4a.test.ts` › traspasos; E: `compras.mjs` | Cubierto (4A) |
| AC-34b | Conteo físico completo o por categoría, a ciegas para quien cuenta, con diferencia contra la existencia del momento de captura y ajuste autorizado. | I: `phase4a.test.ts` › conteo; E: `compras.mjs` | Cubierto (4A) |
| AC-34c | Sugerencias de compra por punto de reorden, venta de 30 días, lo ya pedido y tiempo de entrega; generan órdenes en borrador por proveedor. | I: `phase4a.test.ts` › sugerencias; E: `compras.mjs` | Cubierto (4A) |
| AC-30 | Promociones configurables con explicación en el ticket. | — | Pendiente (4D) |
| AC-31 | Pagos divididos en el punto de venta. | — | Pendiente (4B) |
| AC-32 | Clientes con historial de compras. | — | Pendiente (4B) |
| AC-33 | Devoluciones y cambios con o sin retorno a inventario. | — | Pendiente (4C) |
| AC-35 | Ventas a crédito con límite y abonos. | — | Pendiente (4B) |

## Fase 5

AC-40 Reportes por sucursal y periodo con exportación CSV/XLSX/PDF. · AC-41 Utilidad marcada como incompleta si faltan costos. · AC-42 Pedidos omnicanal con estados unificados. · AC-43 Facturación con adaptador real o sandbox identificado. · AC-44 Integraciones por adaptador sin datos falsos.

## Criterio global de "terminado"

El sistema no se declara terminado hasta que todos los AC de las cinco fases estén cubiertos por pruebas o procedimiento manual ejecutado y documentado, y ningún adaptador sandbox esté activo en producción sin etiqueta visible.
