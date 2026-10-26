# 09 · Roadmap

Versión 0.1 · 2026-10-26

Sin fechas: Jano no ha fijado una fecha de inicio ni dedicación del equipo. Las duraciones son estimaciones relativas para un equipo de dos personas con apoyo de IA y se revisan al cerrar cada fase.

| Fase | Entregable | Contenido | Estimación relativa | Hito de salida |
| --- | --- | --- | --- | --- |
| 1 | Especificación | Documentos 01–09, ADRs | Hecha | Revisión y aprobación de Jano y Beto |
| 2 | Base técnica | Auth, tenants, empresas, sucursales, almacenes, cajas, usuarios, roles, módulos, configuración regional, navegación, diseño base, bitácora, semillas, pruebas, despliegue | Hecha (esta entrega) | AC-01…AC-13 en verde; demo en Vercel |
| 3 | Primer producto funcional (vertical slice) | Catálogo con variantes y códigos, inventario con libro inmutable, POS táctil, venta en efectivo, descuento de inventario, ticket, apertura/corte de caja, PWA offline básica, sincronización idempotente | Hecha (2026-10-26, ver doc 11) | Pendiente: una tienda piloto vende un día completo con y sin internet |
| 4 | Operación comercial | Proveedores y compras, traspasos, devoluciones y cambios, pagos divididos, clientes y crédito, promociones y listas de precios, métodos de pago configurables | 4–6 semanas | Piloto reemplaza su sistema anterior |
| 5 | Crecimiento y analítica | Pedidos omnicanal y ecommerce por adaptador, facturación opcional (PAC + sandbox), lealtad, reportes y dashboard, exportaciones, programación por correo, integraciones | 6–8 semanas | Primer cliente con sucursales múltiples y facturación |
| 6 (después) | Endurecimiento y escala | RLS en Postgres, MFA, API pública documentada, marketplace de integraciones, apps nativas si el mercado lo pide | — | — |

## Orden recomendado dentro de la Fase 3

1. Catálogo (productos, variantes, códigos de barras, categorías, unidades, impuestos).
2. Inventario (ledger, saldos, entradas/ajustes, kardex).
3. Caja (apertura, retiros, cortes) antes que el POS, porque toda venta necesita turno abierto.
4. POS online (búsqueda, escaneo, carrito, efectivo, ticket).
5. PWA y catálogo local; después ventas offline y cola de sincronización.
6. Pruebas de sincronización con reenvío y conflictos.

## Decisiones pendientes de Jano

- Nombre comercial del producto y dominio.
- Modelo de precios del SaaS (por sucursal, por caja o por módulos) — afecta `tenants.plan` y la activación de módulos.
- Cliente piloto para la Fase 3.
- Proveedor de facturación (PAC) y de pagos con terminal a integrar primero.
