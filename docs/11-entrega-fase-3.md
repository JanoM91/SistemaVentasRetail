# 11 · Reporte de entrega — Fase 3 (primer producto funcional)

Fecha: 2026-10-26 · Autor: equipo de desarrollo (IA) para Jano y Beto

## 1. Qué se entrega

El primer corte vendible: una tienda puede dar de alta su catálogo, cargar existencias, abrir caja, vender con o sin internet, imprimir ticket, cancelar con autorización y hacer el corte del día.

| Área | Entregado |
| --- | --- |
| Catálogo | Productos simples y con variantes (hasta 3 atributos, generador de combinaciones), SKU, varios códigos de barras por variante, categorías y marcas creadas al escribir, unidades (pieza, kg, litro… con claves SAT), impuestos (IVA 16 %, 8 %, 0 %, exento), favoritos del POS, existencia inicial, mínimos y punto de reorden, activar/desactivar. |
| Inventario | Libro de movimientos **inmutable** (trigger en Postgres), saldos por almacén, costo promedio ponderado, entradas/salidas/mermas/dañados/caducados con motivo, reverso compensatorio, kardex por variante, alertas (bajo, agotado, negativo), valor del inventario y aviso de productos sin costo, `npm run stock:verify`. |
| Caja | Apertura con fondo, retiros y depósitos (con autorización si el rol no lo permite), corte X en vivo, corte Z con conteo por denominación (MXN), diferencia (sobrante/faltante), un solo turno abierto por caja, historial de turnos, impresión del corte. |
| Punto de venta | Pantalla completa táctil y con teclado: búsqueda instantánea, lector de códigos (teclado), favoritos y categorías, variantes, granel con decimales, cantidades, descuento por línea (con tope y autorización de gerente), poner en espera y recuperar, cobro en efectivo con montos rápidos y cambio, tarjeta/transferencia con referencia, ticket de 80 mm, atajos F2/F4/F8. |
| Offline | PWA instalable con iconos Exkalibur, service worker que abre `/pos` sin red, catálogo en IndexedDB, cola de ventas offline (solo efectivo), sincronización automática por lotes, estados aplicada/duplicada/con observaciones/rechazada, historial y reintento en el dispositivo. |
| Ventas | Listado por día/turno/estado con totales y ticket promedio, filtro de ventas con observaciones, detalle con costo y utilidad (marcada **no confiable** si faltan costos), reimpresión, cancelación con motivo y autorización. |
| API | `GET /api/v1/pos/catalog`, `POST /api/v1/pos/sales`, `POST /api/v1/sync`, `GET /api/v1/pos/registers`, `GET /api/v1/catalog/variants`, con sesión, protección CSRF y errores accionables. |

## 2. Pruebas ejecutadas

| Suite | Resultado |
| --- | --- |
| Unitarias (Vitest) | 23/23: permisos (13) y cálculo de importes (10: redondeo bancario, IVA incluido y no incluido, granel, descuentos, captura de importes). |
| Integración (Vitest + Postgres) | 41/41: Fases 1–2 (24) y Fase 3 (17): catálogo, inventario, inmutabilidad, existencia negativa, permisos de costo, venta en efectivo, folios, idempotencia (reenvío y 4 envíos simultáneos), reglas en línea, anomalías offline, descuentos autorizados y tope, cancelación + corte Z cuadrado, un turno por caja, aislamiento entre cuentas. |
| E2E Fase 3 (Playwright, `tests/e2e/pos.mjs`) | 24/24: abrir caja → venta en línea (código de barras, búsqueda, variante) con folio V-000001 → cortar la red → venta offline → **recargar la página sin red** → otra venta → reconectar → sincronización automática con folios V-000002/3 → inventario correcto → corte Z que cuadra en $779.00 → alta de producto por el gerente → POS en celular. |
| E2E Fase 2 (`tests/e2e/smoke.mjs`) | 22/22 (sin regresiones). |
| `typecheck`, `lint`, `build` | Sin errores. |

## 3. Decisiones y supuestos de esta fase

1. **Folio en el servidor, por sucursal** (serie «V»). Las ventas offline muestran folio «PENDIENTE» en el ticket hasta sincronizar (ADR-004).
2. **Sin internet solo efectivo**: un pago con terminal o transferencia no se puede confirmar sin red.
3. **Precios con impuesto incluido** al capturar; el desglose se calcula por línea con redondeo bancario. El mismo código calcula en el navegador y en el servidor.
4. **Costo de referencia = último costo de entrada**; el costo de ventas usa el costo promedio del almacén al momento de vender.
5. **Cancelación solo en el turno abierto**; después, será devolución (Fase 4).
6. **Iconos de la app**: nombre corto «Caja», isotipo Escalón, generados con el script del kit de marca. Diferencia con el estándar: `start_url` es `/pos` (no `/`) para que la app instalada abra el punto de venta, que es la única pantalla disponible sin conexión.

## 4. Cómo probarlo

1. `npm run db:reset` (o `db:migrate` + `db:seed`) carga el catálogo demo: 11 productos (bebidas, botanas, abarrotes, granel y una playera con 4 variantes) con existencias en Sucursal Centro.
2. Entra como `cajero / Cajero1234!` → **Caja** → «Abrir caja» con un fondo → **Punto de venta**.
3. Escanea o escribe `7500000000011` (refresco) y Enter; toca «Playera» y elige una talla; **Cobrar** (F4).
4. Para probar offline: con el POS abierto, desactiva el Wi-Fi (o DevTools → Network → Offline), vende en efectivo, recarga la página, vuelve a conectar y observa «0 pendientes».
5. Cierra el día en **Caja → Corte X / cerrar turno**.
6. Instalar como app: iPhone → Safari → Compartir → «Agregar a pantalla de inicio»; Android → Chrome → ⋮ → «Instalar app».

## 5. Pendientes y riesgos conocidos

- **Impresión directa** a impresora térmica: hoy se imprime con el diálogo del navegador (funciona con impresoras de 80 mm instaladas en el sistema). La impresión sin diálogo (WebUSB/servicio local) queda para cuando haya cliente piloto con hardware definido.
- **Pagos divididos, devoluciones, clientes, promociones, compras y traspasos**: Fase 4 (el modelo de pagos ya soporta varios pagos por venta).
- **Revisión de ventas con observaciones** y del registro `sync_events`: hoy se consultan en Ventas (filtro) y en la base; una pantalla de conciliación para el gerente queda para la Fase 4.
- **Celular**: el POS funciona, pero en pantallas pequeñas el carrito queda debajo de los productos; un carrito deslizable mejoraría el uso con una mano.
- **Catálogos muy grandes** (> 20 000 variantes): el catálogo se descarga completo; si un cliente lo requiere, se hará descarga incremental por `updated_at`.
