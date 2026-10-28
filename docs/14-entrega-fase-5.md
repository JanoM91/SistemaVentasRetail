# 14 · Reporte de entrega — Fase 5 (crecimiento y analítica)

Fecha: 2026-10-27 · Autor: equipo de desarrollo (IA) para Jano y Beto · Estado: **en curso** (5A entregado)

## 1. Qué se entrega

| Bloque | Commit | Entregado |
| --- | --- | --- |
| 5A Reportes y dashboard | (este commit) | Dashboard con indicadores comparados contra el periodo anterior; 7 reportes con filtro de periodo y sucursal; utilidad con aviso de costos faltantes; exportación CSV, Excel y PDF; venta de «Hoy» en Inicio. |
| 5B Facturación CFDI 4.0 | — | Pendiente: adaptador por PAC con sandbox identificado. |
| 5C Pedidos omnicanal | — | Pendiente. |
| 5D Lealtad y saldo a favor | — | Pendiente. |
| 5E Integraciones | — | Pendiente: pagos (terminal/QR) y mensajería, sin datos simulados. |

### Reportes (5A)

- **Periodos:** hoy, ayer, últimos 7 y 30 días, este mes, mes anterior, este año o un rango de fechas (máximo dos años). Los días cortan a medianoche en la zona horaria de la empresa, no en UTC. Cada periodo se compara con el anterior de la misma duración.
- **Sucursal:** todas las que el usuario puede ver o una en particular; nunca una ajena.
- **Resumen:** venta neta (ventas menos devoluciones por fecha de devolución), tickets, ticket promedio, utilidad bruta o descuentos; venta por día (o por hora si es un solo día); formas de pago; productos y categorías.
- **Ventas:** por sucursal, forma de pago, vendedor, hora del día y día de la semana.
- **Productos y utilidad:** por categoría y por producto (vendido, devuelto, venta neta, utilidad y margen).
- **Inventario:** existencias, costo promedio y valor, venta de 30 días, días de cobertura, última venta; indicadores de productos en cero, con cobertura menor a 7 días y sin venta en 30 días.
- **Clientes:** nuevos contra recurrentes, venta con y sin cliente identificado, mejores 50 clientes.
- **Promociones:** usos, descuento y venta de los tickets por promoción; descuento por promociones contra descuentos manuales.
- **Cortes de caja:** cortes Z del periodo con esperado, contado y diferencia; total de faltantes y sobrantes.
- **Exportación:** las tablas de pantalla y las exportadas salen de la misma función (`buildReport`), así que siempre coinciden. CSV con BOM (Excel respeta acentos), Excel con una hoja por tabla y números con formato, PDF carta horizontal con paginación. Cada exportación queda en la bitácora (`reports.export`).

### Reglas de utilidad (criterio 11 / AC-41)

- Utilidad = importe neto sin IVA − costo de la línea al momento de la venta.
- Una línea sin costo registrado **no** se cuenta como utilidad cero: se excluye, se reporta su venta como «venta sin costo registrado» y la utilidad y el margen se marcan como incompletos en pantalla y en el archivo exportado.
- Solo la ven quienes tienen `reports.view_profit` (dueño y gerente en los roles de fábrica). Sin ese permiso se ocultan costos, valor del inventario y utilidad, también en las exportaciones.

### Gráficas

Una sola serie por gráfica (el título dice qué se mide, sin leyenda), columnas delgadas con extremo redondeado, cuadrícula discreta y tooltip al pasar el cursor o al enfocar con teclado. Debajo de cada gráfica está la tabla con los mismos datos, para quien no puede o no quiere leer la gráfica.

## 2. Pruebas ejecutadas

| Suite | Resultado |
| --- | --- |
| Unitarias + integración (Postgres real) | 105/105. Nuevas: `period.test.ts` (periodos, horario, comparativo) y `phase5a.test.ts` (resumen con producto sin costo, devoluciones y cancelaciones; zona horaria y permisos; 7 reportes × 3 formatos). |
| E2E (Playwright) | 7 recorridos sobre base limpia, 156 verificaciones, 0 fallas. Nuevo `reportes.mjs` (26): cajero sin acceso (menú, página y API 403), indicadores de Hoy, gráfica por hora y por día con tooltip, rango personalizado, 7 pestañas, descarga de Excel/CSV/PDF válidos y utilidad visible para el dueño. |
| `typecheck`, `lint`, `build` | Sin errores. |

## 3. Decisiones y supuestos

1. **Devoluciones por fecha de devolución**, no de la venta original: la venta neta de un día refleja el dinero que realmente salió ese día.
2. **Ventas canceladas** no suman venta; se muestran aparte (cantidad e importe).
3. **La cobertura de inventario** usa la venta de los últimos 30 días sin importar el periodo elegido; las cancelaciones no cuentan como demanda.
4. **Tablas en pantalla** se limitan (200 productos, 300 artículos de inventario); la exportación siempre incluye todo.
5. **Envío programado de reportes** (`reports.schedule`) queda para 5E, porque necesita la integración de correo; no se dejó un botón sin función.

## 4. Dependencias y auditoría

- Nuevas: `exceljs` (Excel) y `pdfkit` (PDF), solo en el servidor. Se fijó `uuid` ≥ 11.1.1 por una vulnerabilidad de `exceljs`.
- `npm audit` reporta `postcss` dentro de `next` 15 (se usa al compilar CSS, no procesa datos del usuario en ejecución). La corrección exige `next` 16, un cambio mayor; se hará en un bloque propio con pruebas completas antes de producción.

## 5. Cómo probarlo

1. `npm run db:reset` y `npm run dev`.
2. Como `cajero`: abre caja y vende algunos productos (incluye 3 galletas de avena: verás el 3x2, y como en el demo no tienen costo registrado, el reporte marcará la utilidad como incompleta).
3. Como `gerente`: **Inicio** muestra la venta de hoy; **Reportes** → cambia el periodo a «Hoy» y verás la gráfica por hora; revisa «Productos y utilidad» (aviso de utilidad incompleta) y descarga Excel, CSV y PDF.
4. Como `cajero`, intenta abrir `/reportes`: te manda a «Sin permiso».
