# 01 · Resumen del producto, alcance y supuestos

Versión 0.1 · 2026-10-26 · Fase 1 (análisis y especificación)

## 1. Resumen del producto

**Sistema de Caja** (nombre provisional; el nombre comercial está pendiente) es una plataforma SaaS de gestión comercial para negocios retail de cualquier giro: ropa, abarrotes, ferreterías, farmacias, electrónica, accesorios, belleza, papelerías y comercios especializados.

Resuelve cuatro cosas para el dueño de un comercio:

1. **Vender rápido** desde computadora, tableta o celular, con o sin internet.
2. **Controlar** productos, variantes, costos, inventarios, almacenes y sucursales desde un solo lugar.
3. **Conocer al cliente** y usar esa información en crédito, promociones y fidelización.
4. **Ver resultados** en reportes operativos, financieros y analíticos en tiempo real.

Es multiempresa desde el inicio: un mismo despliegue atiende a muchos negocios (tenants) con separación estricta de datos, y cada negocio puede tener varias empresas, sucursales, almacenes y cajas. Los módulos se activan por empresa, de modo que un abarrotes de una sola caja ve una interfaz mínima y una cadena con diez sucursales ve la completa.

Es un producto propio de Exkalibur Consulting (decisión de Jano, 2026-10-26), pensado inicialmente para México, con arquitectura preparada para otros países (moneda, idioma, impuestos, zona horaria y facturación electrónica configurables por adaptador).

## 2. Alcance

### 2.1 Dentro del alcance (producto completo, fases 1–5)

| Área | Contenido |
| --- | --- |
| Administración | Tenants, empresas, sucursales, almacenes, ubicaciones, cajas, usuarios, roles, permisos, monedas, impuestos, series/folios, métodos de pago, canales, listas de precios, configuración regional, parámetros de inventario/promociones/facturación, notificaciones, módulos activables. |
| Catálogo | Productos simples y con variantes, atributos configurables, múltiples códigos de barras, categorías, marcas, unidades y conversiones, imágenes, proveedores, mínimos/máximos/punto de reorden por sucursal y almacén. |
| Inventario y costos | Libro de movimientos inmutable, saldos por ubicación, entradas, salidas, ajustes, traspasos, conteos, reservas, mermas, lotes, caducidades, series, costeo promedio/FIFO/manual/por lote, kardex, alertas, sugerencias de compra. |
| Compras | Proveedores, órdenes, recepciones parciales/completas, facturas de proveedor, costos adicionales, devoluciones, historial de precios, cuentas por pagar básicas, importación desde archivos. |
| Punto de venta | POS táctil y con teclado, búsqueda instantánea, escaneo, favoritos, promociones automáticas, cliente, cupones, pagos divididos, cambio, ticket, suspender/recuperar, cotizaciones, crédito, apertura/cierre de caja, retiros/depósitos, arqueo, cortes X y Z, operación offline con sincronización idempotente. |
| Canales y pedidos | Modelo unificado de pedidos (recibido → devuelto) para tienda física, ecommerce, WhatsApp, redes, teléfono, marketplace, recoger en tienda y entrega a domicilio, mediante adaptadores. |
| Pagos | Arquitectura extensible: efectivo, tarjetas, transferencia, QR, billeteras, terminal integrada, dividido, parcial, crédito, tarjeta de regalo, saldo prepago, cupones, puntos, financiamiento. Tokenización; nunca se almacenan datos de tarjeta. |
| Clientes | CRM comercial, direcciones, historial, consentimientos, crédito, puntos, tarjetas de regalo, etiquetas, segmentos manuales y automáticos. |
| Promociones y precios | Motor de reglas con vigencia, horarios, sucursales, canales, productos, categorías, segmentos, límites, exclusiones, compatibilidad, prioridad y explicación de lo aplicado. |
| Devoluciones y cambios | Totales, parciales, cambios de producto/variante, reembolso a método original, crédito en tienda, con/sin ticket, con autorización, con o sin retorno a inventario. |
| Facturación electrónica | Capa opcional por país mediante adaptador; para México, integración configurable con PAC autorizado; modo simulado claramente identificado si no hay credenciales. |
| Reportes y analítica | Dashboard ejecutivo y reportes filtrables, agrupables, comparables, exportables (CSV/XLSX/PDF), programables por correo. Utilidad marcada como incompleta cuando faltan costos. |
| Offline | PWA instalable, catálogo local, ventas y pagos en efectivo sin internet, cola de sincronización idempotente, detección de conflictos. |
| Integraciones | Adaptadores reemplazables para hardware (lectores, impresoras, cajones, básculas, terminales), facturación, contabilidad, bancos, ecommerce, WhatsApp, SMS, correo, marketplaces, entregas, archivos, ERP. |
| Seguridad | Hashing de contraseñas, sesiones seguras, protección contra inyección/XSS/CSRF, validación, control de acceso en cliente y servidor, aislamiento por tenant, bitácora, secretos fuera del código, respaldos, protección de datos personales, retención configurable. |

### 2.2 Fuera del alcance (por ahora)

- Contabilidad completa (solo cuentas por pagar/cobrar básicas y exportación a contabilidad).
- Nómina, recursos humanos y control de asistencia.
- Manufactura, recetas de producción y órdenes de trabajo (sí combos/paquetes de venta).
- Restaurantes con comandas y mesas (el POS es retail; podría extenderse después).
- Pasarela de pagos propia (se integran proveedores).
- Portal de ecommerce propio (se integra con tiendas existentes mediante adaptadores; un storefront básico podría evaluarse en fase 5).
- Apps nativas de tienda (App Store/Play Store). La PWA cubre tableta y celular.
- Inicio de sesión social, SSO o MFA en la primera versión (sí previsto en el diseño de sesiones).

### 2.3 Alcance de esta entrega (Fase 1 + Fase 2)

Fase 1 entrega esta especificación (documentos 01–09 y decisiones de arquitectura). Fase 2 entrega la base técnica: autenticación por usuario y contraseña, tenants, empresas, sucursales, almacenes, usuarios, roles y permisos, módulos activables, configuración inicial, base de datos con migraciones, navegación, diseño visual base y bitácora de auditoría, con semillas, pruebas y documentación de instalación. El POS, catálogo e inventario llegan en la Fase 3.

## 3. Supuestos

Decisiones tomadas por el equipo de desarrollo (IA) porque no bloqueaban la implementación. Cualquiera puede revertirse en revisión; están marcadas con el documento donde se detallan.

| # | Supuesto | Por qué | Dónde |
| --- | --- | --- | --- |
| S1 | Nombre de producto provisional "Sistema de Caja"; el nombre comercial se define después. | Jano no lo ha definido. | — |
| S2 | ORM: **Drizzle ORM + drizzle-kit** en lugar de Prisma. | Prisma requiere descargar binarios desde `binaries.prisma.sh`, bloqueado en el entorno de construcción; Drizzle es TypeScript puro, genera migraciones SQL versionadas y funciona igual en Supabase y Vercel. | ADR-001 |
| S3 | Base de datos en Supabase (Postgres 17) y aplicación en Vercel; Docker Compose solo para desarrollo local. | Elección de Jano (2026-10-26); Exkalibur ya opera otros proyectos ahí. | ADR-002 |
| S4 | Autenticación propia con usuario/contraseña, sesiones opacas en base de datos y cookie httpOnly. No se usa Supabase Auth. | El prompt pide usuario y contraseña; una sesión propia da control total sobre roles, tenants y auditoría, y evita acoplar el producto a un proveedor. | ADR-003 |
| S5 | Jerarquía: Tenant → Company → Branch → Warehouse → Location. El usuario pertenece al tenant y recibe un rol por empresa; opcionalmente se restringe a sucursales. | Permite una cuenta con varias empresas (grupo empresarial) y cajeros limitados a su sucursal. | 05 |
| S6 | Roles iniciales del sistema: superadministrador (plataforma), dueño, gerente, cajero. Los roles son plantillas de permisos; se pueden crear roles personalizados por tenant. | Pedido en el prompt; los permisos finos requieren roles personalizables. | 03 |
| S7 | Moneda base por empresa, con precios y costos en centavos enteros (`bigint`) para evitar errores de redondeo. Tipo de cambio por venta cuando aplique otra moneda. | Práctica estándar en sistemas de pago. | 05 |
| S8 | Zona horaria y configuración regional por empresa, con posibilidad de sobreescritura por sucursal. | Cadenas con sucursales en distintas zonas. | 05 |
| S9 | Identificadores UUID v7 generados en el cliente cuando haga falta (POS offline) y en el servidor en los demás casos. | Idempotencia y orden temporal para la sincronización. | 04 |
| S10 | Español (México) como único idioma en la primera versión; los textos se centralizan para traducir después. | Pedido en el prompt. | 04 |
| S11 | La facturación electrónica mexicana (CFDI 4.0) se integra con un PAC por adaptador; se implementa un adaptador simulado etiquetado como tal hasta que existan credenciales. | Pedido en el prompt; evita fingir timbrado. | 04 |
| S12 | En fase 2 no se publica la API externa; se dejan los cimientos (`/api/v1`, autenticación por sesión y por token de integración en diseño). | Evita exponer superficie sin pruebas. | 04 |

## 4. Usuarios objetivo

- **Dueño** de uno o varios comercios: quiere ver ventas, utilidad, inventario y caja sin depender de nadie; decide compras y precios.
- **Gerente** de sucursal o encargado: administra catálogo, inventario, compras, promociones y usuarios de su sucursal; autoriza descuentos, cancelaciones y devoluciones.
- **Cajero** o vendedor: vende, cobra, abre y cierra caja; no ve costos ni utilidades.
- **Superadministrador** (Exkalibur): opera la plataforma, crea tenants, habilita módulos y atiende soporte sin tocar datos de negocio salvo con bitácora.

## 5. Principios de diseño

1. Pocos pasos para vender: una venta en efectivo en menos de 5 interacciones.
2. El servidor manda: toda regla de negocio y permiso se valida en el backend aunque la interfaz también lo haga.
3. Nada se borra en silencio: movimientos inmutables, desactivación en lugar de borrado, correcciones compensatorias, bitácora.
4. Un módulo a la vez: monolito modular con límites claros; cada módulo expone acciones, consultas y validaciones, no tablas.
5. Sin datos falsos: integraciones sin credenciales corren en modo sandbox identificado en pantalla.
6. Primero México, nunca solo México: todo lo fiscal y regional vive en configuración y adaptadores.
