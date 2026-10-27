# 13 · Reporte de entrega — Fase 4 (operación comercial)

Fecha: 2026-10-27 · Autor: equipo de desarrollo (IA) para Jano y Beto

## 1. Qué se entrega

Con la Fase 4 una tienda puede operar el ciclo comercial completo: comprar a proveedores, mover mercancía entre sucursales, contar inventario, vender a clientes registrados (también a crédito y con varios pagos), aceptar devoluciones y cambios, y aplicar promociones, cupones y precios de mayoreo. Se entregó en cuatro bloques, cada uno publicado y verificado por separado.

| Bloque | Commit | Entregado |
| --- | --- | --- |
| 4A Compras e inventario avanzado | `e3a5b17` | Proveedores; órdenes de compra (borrador → enviada → parcial → cerrada); recepción con flete prorrateado al costo; compra directa; devolución a proveedor con nota de crédito; cuentas por pagar; sugerencias de compra; traspasos con tránsito; conteo físico a ciegas. |
| 4B Clientes y crédito | `fbfd7c0` | Clientes con datos fiscales, grupos, segmentos y consentimiento; cliente en la venta y alta rápida; pagos divididos; venta a crédito con límite y autorización; abonos en caja que entran al corte; estado de cuenta inmutable; cuentas por cobrar por antigüedad. |
| 4C Devoluciones y cambios | `031f178` | Devoluciones parciales/totales con y sin ticket; reembolso en efectivo, al medio original, a cuenta o con vale; cambios con vale aplicado a la nueva venta; política configurable. |
| 4D Promociones y precios | (este commit) | Motor de promociones compartido POS/servidor con explicación en ticket; cupones; listas de precios por grupo; métodos de pago e impuestos editables; revisión de ventas con observaciones. |

### Motor de promociones (4D)

- **Tipos:** porcentaje, monto por pieza, precio especial, lleva X paga Y (2x1, 3x2), volumen por tramos, paquete/combo, porcentaje o monto al ticket.
- **Alcance:** todos, categorías o productos (todas sus variantes).
- **Condiciones:** vigencia, días de la semana, horario (zona de la empresa), sucursales, grupos de clientes, compra mínima, cupón.
- **Límites:** usos totales y por cliente (el servidor bloquea la promoción mientras registra la venta para no pasarse).
- **Prioridad y acumulación:** sin acumulación cada producto recibe solo la de mayor prioridad y las de ticket solo aplican si ninguna otra aplicó.
- **Mismo código** en el navegador (también sin conexión) y en el servidor. En línea, si no coinciden, la venta se rechaza con `promotions_changed` y el POS actualiza su catálogo; sin conexión se respeta lo cobrado y la venta queda marcada para revisión.
- **Explicación:** cada promoción aplicada aparece en el carrito y en el ticket, por ejemplo «3x2 en galletas (3x2): −$35.00».

## 2. Pruebas ejecutadas

| Suite | Resultado |
| --- | --- |
| Unitarias | 31/31: permisos, importes y motor de promociones (8 escenarios: tipos, 2x1 con granel, combos, prioridad y acumulación, reparto al ticket sin perder centavos, condiciones de fecha/hora/sucursal/grupo/cupón, listas de precios). |
| Integración (Postgres real) | 67/67: Fases 1–3 y 4A (7), 4B (10), 4C (5), 4D (4). |
| E2E (Playwright) | 134/134 en 6 recorridos sobre base limpia: `pos` 24, `smoke` 22, `compras` 27, `clientes` 23, `devoluciones` 17, `promociones` 21. |
| `typecheck`, `lint`, `build` | Sin errores. |

## 3. Decisiones y supuestos de esta fase

1. **Costos sin IVA** en compras; el flete se reparte por valor y alimenta el costo promedio.
2. **El cajero no vende a crédito sin autorización** (no tiene `pos.credit_sale`); se otorga en Roles si la tienda lo quiere.
3. **Devoluciones:** 30 días por defecto; reembolso en efectivo con autorización; sin ticket solo vale. Todo configurable.
4. **Sin conexión** no se aceptan crédito, vales ni cupones (solo efectivo); las promociones automáticas sí funcionan.
5. **Promociones no acumulables por defecto** (Configuración → «Permitir acumular promociones»).
6. **Listas de precios por grupo de clientes**, no por cliente individual; precio fijo por producto o ajuste porcentual general.
7. **Revisión de ventas:** la hace quien puede cancelar ventas (`pos.cancel`, gerente o dueño).
8. **Cambiar la tasa de un impuesto** afecta ventas nuevas; si un punto de venta vendió sin conexión con la tasa anterior, la venta puede rechazarse al sincronizar por no cuadrar y aparecerá en «Por revisar».

## 4. Cómo probarlo

1. `npm run db:reset` carga demo con proveedores, clientes, promociones (3x2 en galletas, jugo mañanero, cupón `BIENVENIDA10`) y lista de precios Mayoreo.
2. `npm run dev` y entra como `cajero`: abre caja, vende 3 galletas (verás el 3x2), agrega a «Tienda La Esquina» y el arroz baja a $27, cobra con tarjeta + crédito (pide al `gerente`), registra un abono, haz una devolución con vale y cámbiala por otro producto.
3. Como `gerente`: Compras, Clientes → Por cobrar, Promociones, Ventas → Devoluciones y Por revisar.

## 5. Pendientes que pasan a la Fase 5

Reportes por sucursal y periodo con exportación (criterio 12) y reporte de utilidad (criterio 11 parcial); facturación CFDI; pedidos omnicanal; lealtad; integraciones de pago y mensajería. Además: despliegue en Supabase + Vercel (espera confirmación de costo) y un cliente piloto.
