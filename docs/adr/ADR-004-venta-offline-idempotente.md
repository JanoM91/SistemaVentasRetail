# ADR-004 · Venta offline con UUID del cliente e idempotencia en el servidor

Fecha: 2026-10-26 · Estado: aceptada

## Contexto
El punto de venta debe vender sin internet y sincronizar después sin duplicar ventas (requisito explícito). Las causas típicas de duplicado son: reintentos automáticos, respuesta perdida tras un registro exitoso, dos pestañas o dispositivos enviando la misma cola, y el cajero que vuelve a cobrar cuando la red falla.

## Decisión
1. El dispositivo genera el identificador de la venta (UUID v7, ordenable por tiempo) y lo usa como **llave primaria** de `sales`. El mismo cobro conserva su UUID entre reintentos.
2. `createSale` es idempotente: si el UUID existe devuelve `duplicate` con la venta original; si dos envíos simultáneos compiten, la llave primaria hace fallar al segundo y se devuelve `duplicate` (probado con 4 envíos concurrentes).
3. La venta completa (folio, líneas, pagos, salidas de inventario) se registra en **una transacción** que bloquea el turno de caja y la serie de folios; el folio se asigna en el servidor (por sucursal), nunca en el dispositivo.
4. En línea las reglas son estrictas; offline se respeta lo cobrado y las anomalías se marcan en `sales.flags` en lugar de rechazar.
5. Lo que no se puede registrar se rechaza, se conserva en el dispositivo y en `sync_events` para revisión.

## Alternativas descartadas
- **Folio asignado en el dispositivo** (rangos por caja): evita «PENDIENTE» en el ticket, pero complica la numeración y la cancelación de rangos. Se puede agregar después si un cliente lo exige.
- **Cola en el service worker (Background Sync):** no está disponible en Safari/iOS; la cola en IndexedDB gestionada por la página funciona en todos los navegadores.
- **CRDT/sincronización bidireccional del catálogo:** innecesaria; el catálogo es de solo lectura en el POS y se reemplaza completo.

## Consecuencias
- Sin red, el ticket muestra folio «PENDIENTE»; el folio definitivo aparece en el historial del POS y en Ventas al sincronizar.
- Un dispositivo manipulado podría enviar precios falsos por sincronización: quedan marcados (`price_changed`) y auditables, no se ocultan.
- Las ventas de un turno que ya se cerró se asocian a ese turno y se marcan; el corte Z guardado no se recalcula (se revisa en Ventas).
