# 08 · Riesgos

Versión 0.1 · 2026-10-26

| # | Riesgo | Probabilidad | Impacto | Mitigación | Dueño |
| --- | --- | --- | --- | --- | --- |
| R1 | Alcance muy amplio para un equipo de dos personas; el producto tarda en generar ingresos. | Alta | Alto | Entregar por fases con un vertical slice vendible en F3 (catálogo + POS + corte); vender acompañamiento sobre esa base antes de F4/F5. | Jano |
| R2 | Sincronización offline con duplicados o pérdida de ventas. | Media | Alto | Ids generados en cliente, `ON CONFLICT DO NOTHING`, cola persistente, pruebas de reenvío de lotes, nunca descartar rechazados. | Beto |
| R3 | Inconsistencia entre libro de inventario y saldos materializados. | Media | Alto | Misma transacción; job de verificación que recalcula desde el ledger y alerta; no editar movimientos. | Beto |
| R4 | Errores de redondeo en impuestos y totales. | Media | Medio | Centavos enteros, redondeo por línea documentado, pruebas unitarias con casos límite (IVA 16 %, IEPS, precios con impuesto incluido). | Beto |
| R5 | Fuga de datos entre tenants por una consulta sin `tenant_id`. | Baja | Crítico | Contexto obligatorio, pruebas de aislamiento, revisión de código de cada módulo, RLS en Postgres como segunda barrera (fase posterior). | Beto |
| R6 | Facturación electrónica mexicana: cambios regulatorios y dependencia de PAC. | Media | Medio | Adaptador por proveedor, sandbox identificado, no hard-codear reglas fiscales en el POS. | Jano |
| R7 | Hardware heterogéneo (impresoras, lectores, cajones) en los clientes. | Alta | Medio | Lector como teclado HID (funciona sin integración), impresión por navegador como respaldo, WebUSB/WebSerial donde esté disponible, servicio local opcional. | Beto |
| R8 | Dependencia de Supabase/Vercel (costos, límites, disponibilidad). | Baja | Medio | Postgres estándar y Dockerfile de la app; nada específico del proveedor en el código. | Jano |
| R9 | Seguridad de contraseñas y sesiones en dispositivos compartidos de tienda. | Media | Alto | Sesiones por dispositivo, expiración por inactividad, autorización en caliente sin cambiar de sesión, bitácora con dispositivo. | Beto |
| R10 | Rendimiento del POS con catálogos grandes (decenas de miles de variantes). | Media | Medio | Índices por código de barras y búsqueda `trigram`; catálogo local en IndexedDB con índices; paginación. | Beto |
| R11 | Cambio de ORM respecto al prompt (Drizzle en lugar de Prisma). | Baja | Bajo | Documentado en ADR-001; Drizzle cubre migraciones y tipado; si se exige Prisma, el esquema se puede traducir porque las migraciones son SQL. | Jano |
| R12 | Datos personales de clientes y obligaciones de la LFPDPPP. | Media | Medio | Consentimientos por canal, retención configurable, exportación/borrado lógico, aviso de privacidad del cliente (responsabilidad del comercio). | Jano |

Riesgos aceptados: no hay MFA en la primera versión; no hay portal de ecommerce propio; la contabilidad se exporta en lugar de integrarse.
