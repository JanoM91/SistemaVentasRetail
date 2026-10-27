# 12 · Estado del producto y pendientes

Fecha: 2026-10-27 (cierre de la Fase 4: bloques 4A–4D) · Base: prompt maestro (15 módulos y 18 criterios de aceptación) contra lo entregado en las Fases 1–4.

## 1. Dónde vive el proyecto

| Lugar | Ruta | Estado |
| --- | --- | --- |
| Carpeta local de Jano | `~/ExKalibur Consulting/SistemaDeVentas ExkCon` | Migrada el 2026-10-27: 3 commits, árbol limpio, remoto `origin` configurado. |
| GitHub | https://github.com/JanoM91/SistemaVentasRetail (público) | Publicado; CI en verde (Fase 3). 4A se entrega como commit nuevo. |
| Base de datos (Supabase) | — | Pendiente: confirmación de costo. |
| Despliegue (Vercel) | — | Pendiente: conectar al repo después del push. |

## 2. Criterios de aceptación del prompt maestro

| # | Criterio | Estado |
| --- | --- | --- |
| 1 | Un dueño crea empresa, sucursal, almacén y usuario | Cumplido (F2) |
| 2 | Un gerente registra productos, variantes, costos y existencias | Cumplido (F3) |
| 3 | Un cajero vende escaneando o buscando | Cumplido (F3) |
| 4 | El inventario se descuenta automáticamente | Cumplido (F3) |
| 5 | Ventas sin internet sincronizadas después | Cumplido (F3) |
| 6 | Promociones configurables | Cumplido (4D) |
| 7 | Pagos divididos | Cumplido (4B) |
| 8 | Clientes e historial | Cumplido (4B) |
| 9 | Devoluciones y cambios | Cumplido (4C) |
| 10 | Control de cajas y cortes | Cumplido (F3) |
| 11 | Costos, margen y utilidad | **Parcial**: por venta y en el inventario; falta el reporte |
| 12 | Reportes por sucursal y periodo | **Pendiente** (hoy: lista de ventas del día y corte de caja) |
| 13 | Permisos impiden acciones no autorizadas | Cumplido (F2–F3) |
| 14 | Operaciones críticas auditadas | Cumplido (F2–F3) |
| 15 | Sin botones principales sin función | Cumplido en lo entregado |
| 16 | Sin datos falsos para simular integraciones | Cumplido (aún no hay integraciones) |
| 17 | Datos de prueba, documentación, credenciales demo | Cumplido |
| 18 | Pruebas unitarias, de integración y de flujos críticos | Cumplido (98 + 6 recorridos E2E) |

Resultado: 16 cumplidos, 1 parcial (utilidad: falta reporte), 1 pendiente (reportes por sucursal y periodo). Ambos son el inicio de la Fase 5.

## 3. Módulos

| Módulo | Hecho | Falta |
| --- | --- | --- |
| 1 Administración | Empresas, sucursales, almacenes, cajas, usuarios, roles, módulos activables, regional, parámetros, impuestos y métodos de pago editables, política de devoluciones | Edición de series de folios; ubicaciones internas; notificaciones |
| 2 Usuarios y permisos | Completo (70 permisos, bitácora, autorización en caliente) | — |
| 3 Catálogo | Simples y variantes, códigos múltiples, categorías, marcas, unidades, favoritos, proveedor principal y último costo (automático al comprar) | Imágenes, importación desde archivo, edición manual de proveedores por producto, relacionados/sustitutos, peso y dimensiones |
| 4 Inventario y costos | Libro inmutable, costo promedio, ajustes, mermas, kardex, alertas, valor, traspasos con tránsito, conteo físico a ciegas, sugerencias de compra | Reservas, lotes/caducidad/series, FIFO, conversiones de unidad, rotación |
| 5 Compras y proveedores | Proveedores, órdenes (borrador → enviada → parcial → cerrada), recepción con flete prorrateado, compra directa, devolución con nota de crédito, cuentas por pagar con pagos parciales, historial de costos | Varias facturas por recepción, anticipos, conversión de unidades de compra (caja → pieza), importación XML de CFDI de proveedor |
| 6 Punto de venta | Venta táctil, escaneo, variantes, granel, descuentos autorizados, en espera, ticket, cancelación, cortes, cliente en la venta, alta rápida de cliente, pago dividido, venta a crédito con autorización, abonos | Cotizaciones, envío de ticket por WhatsApp/correo |
| 7 Canales y pedidos | — | Todo |
| 8 Métodos de pago | Efectivo, tarjeta y transferencia con referencia manual, crédito del cliente, pago dividido | Terminal integrada y QR con adaptador (hoy se registran con referencia manual), tarjetas de regalo, puntos (Fase 5) |
| 9 Clientes y segmentos | Ficha con datos fiscales y dirección, grupos, segmentos (nuevos, frecuentes, en riesgo, sin compras, con saldo, vencidos, aceptan promociones), consentimiento, historial, exportación CSV, crédito y cuentas por cobrar | Lealtad/puntos (Fase 5), fusión de duplicados, campañas |
| 10 Promociones y precios | Descuento manual con tope; motor de promociones (8 tipos, condiciones, prioridad, acumulación); cupones; listas de precios por grupo | Promociones por canal (Fase 5, con canales); vista previa «¿qué promociones aplicarían a esta venta?» en el back-office |
| 11 Devoluciones | Cancelación en el turno; devolución total/parcial con y sin ticket; cambios; vales canjeables; reembolso en efectivo, al medio original o a cuenta; política configurable | Devolución entre sucursales distintas a la de la venta con reembolso en otra caja (hoy sí se permite si el usuario ve ambas); vencimiento de vales |
| 12 Facturación electrónica | — | Adaptador CFDI por PAC + sandbox |
| 13 Reportes | Lista de ventas, detalle con utilidad, corte X/Z, existencias | Dashboard y reportes con filtros, comparativos y exportación |
| 14 Offline | Completo para efectivo | Pagos no-efectivo offline (por decisión, no se ofrecen) |
| 15 Integraciones | Lector de códigos e impresión vía navegador | Adaptadores de pagos, facturación, mensajería, ecommerce |

## 4. Roadmap restante

- **Fase 4 · Operación comercial:** ~~4A compras, proveedores, traspasos, conteos y sugerencias~~ (entregado) · ~~4B clientes, crédito y pagos divididos~~ (entregado) · ~~4C devoluciones y cambios~~ (entregado) · ~~4D promociones, cupones, listas de precios, métodos e impuestos editables y revisión~~ (entregado). **Fase 4 completa.**
- **Fase 5 · Crecimiento y analítica:** reportes y dashboard, exportaciones, facturación CFDI, pedidos omnicanal y ecommerce, lealtad, integraciones.
- **Transversal:** despliegue (Supabase + Vercel), primer cliente piloto, impresión térmica directa, carrito deslizable en celular.
