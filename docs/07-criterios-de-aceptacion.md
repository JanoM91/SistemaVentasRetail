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

AC-30 Promociones configurables con explicación. · AC-31 Pagos divididos. · AC-32 Clientes con historial. · AC-33 Devoluciones y cambios con o sin retorno a inventario. · AC-34 Compras con recepción parcial que afectan costo promedio. · AC-35 Ventas a crédito con límite.

## Fase 5

AC-40 Reportes por sucursal y periodo con exportación CSV/XLSX/PDF. · AC-41 Utilidad marcada como incompleta si faltan costos. · AC-42 Pedidos omnicanal con estados unificados. · AC-43 Facturación con adaptador real o sandbox identificado. · AC-44 Integraciones por adaptador sin datos falsos.

## Criterio global de "terminado"

El sistema no se declara terminado hasta que todos los AC de las cinco fases estén cubiertos por pruebas o procedimiento manual ejecutado y documentado, y ningún adaptador sandbox esté activo en producción sin etiqueta visible.
