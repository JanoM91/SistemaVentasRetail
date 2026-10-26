# 02 · Casos de uso

Versión 0.1 · 2026-10-26

Cada caso indica actor principal, precondición, flujo normal, variantes y resultado verificable. Los casos marcados **F2** se implementan en la Fase 2 (esta entrega); el resto se referencia para que el modelo de datos y los permisos los contemplen desde ahora.

## A. Plataforma y administración

### CU-A01 Crear un tenant (cuenta de cliente SaaS) · F2
- Actor: superadministrador.
- Precondición: sesión con permiso `platform.tenants.manage`.
- Flujo: capturar nombre del negocio, país, moneda y zona horaria por defecto; crear usuario dueño inicial (usuario, nombre, contraseña temporal); activar módulos iniciales.
- Resultado: tenant activo con una empresa, una sucursal, un almacén y una caja creados por defecto; el dueño puede iniciar sesión; evento en bitácora.

### CU-A02 Iniciar y cerrar sesión · F2
- Actor: cualquier usuario.
- Flujo: usuario y contraseña → validación → cookie de sesión httpOnly → redirección a la última empresa/sucursal usada.
- Variantes: contraseña incorrecta (mensaje genérico, contador de intentos, bloqueo temporal tras N fallos); usuario desactivado; sesión expirada.
- Resultado: sesión en base de datos con dispositivo e IP; bitácora de inicio/cierre.

### CU-A03 Administrar empresas · F2
- Actor: dueño.
- Flujo: crear/editar empresa (razón social, nombre comercial, RFC opcional, moneda, zona horaria, idioma, formato de fecha, dirección fiscal); desactivar empresa.
- Resultado: empresa visible en el selector; desactivar oculta pero conserva historial.

### CU-A04 Administrar sucursales, almacenes, ubicaciones y cajas · F2 (sucursales, almacenes y cajas)
- Actor: dueño o gerente con `branches.manage`.
- Flujo: crear sucursal (código, nombre, dirección, teléfono, zona horaria opcional); crear almacenes por sucursal (uno por defecto marcado como principal); crear cajas por sucursal.
- Resultado: estructura disponible para inventario y POS.

### CU-A05 Administrar usuarios · F2
- Actor: dueño o gerente con `users.manage`.
- Flujo: crear usuario (nombre, usuario, correo opcional, contraseña inicial), asignar rol por empresa y sucursales permitidas; restablecer contraseña; desactivar.
- Reglas: un gerente solo puede asignar roles con permisos iguales o menores a los suyos y solo en sus sucursales; nadie puede desactivarse a sí mismo ni eliminar al último dueño.
- Resultado: usuario puede iniciar sesión con lo asignado; bitácora con datos anteriores/nuevos.

### CU-A06 Administrar roles y permisos · F2
- Actor: dueño.
- Flujo: ver roles del sistema (solo lectura), duplicar a rol personalizado, marcar permisos por módulo y acción.
- Resultado: el rol aplica inmediatamente a los usuarios que lo tienen.

### CU-A07 Activar módulos por empresa · F2
- Actor: dueño (o superadministrador).
- Flujo: encender/apagar módulos (catálogo, inventario, POS, compras, clientes, promociones, devoluciones, facturación, reportes, canales, lealtad, crédito).
- Resultado: la navegación y los permisos efectivos solo muestran módulos activos.

### CU-A08 Consultar bitácora · F2
- Actor: dueño o gerente con `audit.view`.
- Flujo: filtrar por fecha, usuario, sucursal, módulo, acción; ver datos anteriores/nuevos y motivo.
- Resultado: lectura; la bitácora no se edita ni se borra desde la aplicación.

### CU-A09 Configuración regional y comercial · F2 (regional) / F3+ (impuestos, folios, métodos de pago)
- Actor: dueño.
- Flujo: moneda, idioma, zona horaria, formatos; impuestos (IVA 16 %, 8 % frontera, 0 %, exento, IEPS), series y folios por sucursal/caja, métodos de pago habilitados, canales.

## B. Catálogo e inventario (F3)

### CU-B01 Alta de producto simple y con variantes
Gerente crea producto con SKU, códigos de barras, categoría, marca, unidad, impuesto, precio, costo y margen objetivo; define atributos (talla, color…) y genera variantes con SKU, código, precio, costo e imagen propios; asigna mínimos, máximos y punto de reorden por sucursal/almacén.

### CU-B02 Entrada de inventario
Gerente registra entrada (compra, ajuste inicial, devolución); el sistema crea movimientos en el libro y actualiza saldos; el costo promedio se recalcula según método de costeo.

### CU-B03 Traspaso entre almacenes o sucursales
Salida en origen (inventario en tránsito) → recepción en destino; diferencias generan movimiento de merma o ajuste con motivo.

### CU-B04 Conteo físico
Se congela el saldo teórico, se captura el físico, se aprueban diferencias y se generan ajustes compensatorios con bitácora.

### CU-B05 Corrección de un movimiento histórico
Nunca se edita: se registra un movimiento inverso y uno nuevo, ambos ligados al original.

## C. Punto de venta (F3)

### CU-C01 Venta en efectivo
Cajero abre turno en su caja con fondo inicial → busca o escanea productos → elige variantes y cantidades → el motor aplica promociones automáticas y explica cuáles → (opcional) asocia cliente → elige efectivo, captura recibido → el sistema calcula cambio → confirma → se descuenta inventario → ticket digital o impreso.

### CU-C02 Venta sin internet
Igual a C01, con catálogo y precios locales; la venta se guarda con UUID local en IndexedDB en estado "pendiente de sincronizar"; al volver la conexión se envía en orden; el servidor rechaza duplicados por idempotencia y reporta conflictos (precio cambiado, producto desactivado) sin bloquear la venta ya cobrada.

### CU-C03 Suspender y recuperar venta, cotización
Ventas suspendidas por caja; cotizaciones con vigencia convertibles a venta.

### CU-C04 Cancelación y reimpresión con autorización
Cajero solicita; gerente autoriza con su usuario y contraseña en el mismo dispositivo; motivo obligatorio; bitácora.

### CU-C05 Apertura, retiros, depósitos, arqueo y corte
Apertura con fondo; retiros/depósitos con motivo; corte X (parcial, no cierra) y corte Z (cierra turno) con conteo por denominación y diferencia registrada.

## D. Operación comercial (F4)

CU-D01 Orden de compra sugerida y recepción parcial · CU-D02 Devolución con reembolso al método original o crédito en tienda · CU-D03 Venta con pago dividido (efectivo + tarjeta + puntos) · CU-D04 Venta a crédito con límite y saldo · CU-D05 Promoción 3x2 por categoría con límite por cliente · CU-D06 Lista de precios por grupo de clientes.

## E. Crecimiento y analítica (F5)

CU-E01 Pedido desde WhatsApp que pasa de recibido a entregado · CU-E02 Factura CFDI desde un ticket, con adaptador de PAC o modo simulado · CU-E03 Reporte de margen por categoría marcado como incompleto si hay productos sin costo · CU-E04 Reporte programado por correo cada lunes · CU-E05 Segmento automático "sin compra en 60 días" usado en una promoción.
