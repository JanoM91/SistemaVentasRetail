# 06 · Flujos principales

Versión 0.1 · 2026-10-26

## 1. Alta de un negocio (F2)

```
Superadmin                     Sistema                                  Dueño
   │ crea tenant + dueño ───────▶ tenants, companies(1), branches(1),
   │                               warehouses(1), cash_registers(1),
   │                               company_modules (catalog, inventory,
   │                               pos, customers, reports = on),
   │                               users(owner) · audit_log
   │                                   │ entrega usuario y contraseña temporal ─▶ │
   │                                   │                                          │ inicia sesión
   │                                   │ ◀──────────────────────────── cambia contraseña (obligatorio)
   │                                   │ ◀──────────────────────────── completa datos de empresa
```

## 2. Inicio de sesión (F2)

1. `POST login` con usuario y contraseña (acción de servidor).
2. Buscar usuario por `username` (sin distinguir mayúsculas). Si no existe, comparar contra un hash ficticio para igualar tiempos y responder "usuario o contraseña incorrectos".
3. Si `locked_until > now`, responder "cuenta bloqueada temporalmente, intenta en N minutos".
4. Verificar bcrypt. Fallo: incrementar `failed_login_attempts`; al llegar a 5, fijar `locked_until = now + 15 min`; bitácora `auth.login_failed`.
5. Éxito: reiniciar contador, crear `sessions` con token aleatorio (hash en BD), cookie `sc_session` httpOnly, `last_login_at`, bitácora `auth.login`.
6. Resolver empresa y sucursal activas: última usada en `users.preferences`, o la primera disponible según `user_company_roles` y `user_branches`.
7. Si `must_change_password` (contraseña temporal), redirigir a cambio de contraseña antes de cualquier otra pantalla.

## 3. Cambio de contexto (empresa/sucursal) (F2)

Selector en la barra superior. Al cambiar, el servidor valida que el usuario tenga rol en esa empresa y acceso a esa sucursal, actualiza `sessions.active_company_id/active_branch_id` y `users.preferences`, y recarga la navegación con los módulos activos de esa empresa.

## 4. Crear usuario con rol y sucursales (F2)

1. Gerente abre "Usuarios → Nuevo"; el formulario solo ofrece roles cuyo conjunto de permisos ⊆ permisos del gerente y sucursales que el gerente puede ver.
2. Servidor: `requirePermission(users.manage)`; valida con zod; verifica las dos reglas anteriores de nuevo; genera contraseña temporal si no se capturó; transacción: `users`, `user_company_roles`, `user_branches`; `audit_log users.create` con `after` (sin hash).
3. Respuesta: muestra la contraseña temporal una sola vez.

## 5. Autorización en caliente (diseño F2, uso F3)

Cuando una acción requiere un permiso que el usuario activo no tiene (descuento, cancelación, reimpresión, devolución, ajuste), la interfaz abre un diálogo "Autorizar con otro usuario": usuario y contraseña del autorizador. El servidor verifica credenciales y permiso del autorizador sin crear sesión, ejecuta la acción en nombre del usuario activo y registra `user_id` (quien ejecuta) y `authorized_by_user_id` (quien autoriza) en la bitácora.

## 6. Venta en efectivo en POS (F3)

```
Cajero         POS (cliente)                      Servidor
  │ abre caja ───▶ cash_sessions.open ───────────▶ valida permiso cash.open, caja libre
  │ escanea ─────▶ busca en IndexedDB (barcode)    
  │ cantidad ────▶ recalcula línea, promociones (motor local, mismas reglas)
  │ cliente? ────▶ opcional
  │ cobrar ──────▶ método efectivo, recibido ≥ total, cambio
  │ confirmar ───▶ sale.id = uuid v7, estado completed, origen online/offline
  │               ├─ online: POST sale ───────────▶ transacción: sales, sale_lines,
  │               │                                 payments, inventory_ledger (sale_out),
  │               │                                 stock_balances, folio, audit
  │               └─ offline: guarda en IndexedDB + sync_queue local
  │ ticket ◀──────┘ impresión / PDF / envío (si hay conexión; si no, pendiente)
```

## 7. Sincronización offline (F3)

1. Al reconectar, el Service Worker o la pestaña activa envía `POST /api/v1/sync` con un lote ordenado por `client_sequence` y `device_id`.
2. Por cada elemento, el servidor: valida tenant/sucursal/caja de la sesión del dispositivo; `INSERT ... ON CONFLICT (id) DO NOTHING`; si ya existía responde `duplicate`; si aplica, ejecuta la misma transacción que una venta online; si detecta diferencias, responde `conflict` con detalle y crea alerta; si es inválido, `rejected` con motivo y entrada en `error_log`.
3. El cliente marca cada elemento según la respuesta y conserva los `rejected` para revisión del gerente; nunca los descarta en silencio.

## 8. Corte de caja (F3)

Corte X: resumen del turno sin cerrar (ventas por método, retiros, depósitos, esperado). Corte Z: captura conteo por denominación, calcula diferencia, cierra `cash_sessions`, bloquea nuevas ventas en esa caja hasta nueva apertura, bitácora `cash.close` con esperado/contado/diferencia. Ventas pendientes de sincronizar se incluyen en el esperado y se marcan en el reporte.

## 9. Devolución con reembolso (F4)

Buscar ticket (o sin ticket si el permiso y la configuración lo permiten) → seleccionar líneas y cantidades → decidir si regresa a inventario (`return_in`) o se registra como dañado → reembolso al método original (adaptador) o crédito en tienda (`credit_movements`/`gift_cards`) → autorización si aplica → bitácora.

## 10. Promoción explicada (F4)

El motor evalúa promociones vigentes (sucursal, canal, horario, segmento, productos) por prioridad; aplica las compatibles respetando `stackable` y límites; cada línea guarda `promotion_id` y `promotion_explanation` ("3x2 en papelería: pagas 2, llevas 3; ahorro $45.00"). El ticket y la pantalla muestran la explicación.

## 11. Factura electrónica (F5)

Desde una venta completada, con datos fiscales del cliente y `invoicing` activo: el adaptador configurado (`INVOICING_PROVIDER`) timbra y guarda UUID, XML y PDF; con `sandbox`, la factura se crea en estado `sandbox`, se muestra con etiqueta "SIMULADA — sin validez fiscal" y nunca se envía al cliente.
