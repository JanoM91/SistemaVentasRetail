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

## Fase 3

AC-20 Un gerente registra productos, variantes, costos y existencias. · AC-21 Un cajero vende escaneando o buscando. · AC-22 El inventario se descuenta automáticamente y el libro es inmutable (las correcciones generan compensatorios). · AC-23 Se realizan ventas sin internet y se sincronizan sin duplicados (prueba con reenvío del mismo lote). · AC-24 Apertura, retiros, arqueo, corte X y Z con diferencia registrada. · AC-25 Ticket digital e impresión.

## Fase 4

AC-30 Promociones configurables con explicación. · AC-31 Pagos divididos. · AC-32 Clientes con historial. · AC-33 Devoluciones y cambios con o sin retorno a inventario. · AC-34 Compras con recepción parcial que afectan costo promedio. · AC-35 Ventas a crédito con límite.

## Fase 5

AC-40 Reportes por sucursal y periodo con exportación CSV/XLSX/PDF. · AC-41 Utilidad marcada como incompleta si faltan costos. · AC-42 Pedidos omnicanal con estados unificados. · AC-43 Facturación con adaptador real o sandbox identificado. · AC-44 Integraciones por adaptador sin datos falsos.

## Criterio global de "terminado"

El sistema no se declara terminado hasta que todos los AC de las cinco fases estén cubiertos por pruebas o procedimiento manual ejecutado y documentado, y ningún adaptador sandbox esté activo en producción sin etiqueta visible.
