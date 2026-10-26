# 04 · Arquitectura

Versión 0.1 · 2026-10-26

## 1. Vista general

Monolito modular en TypeScript sobre Next.js (App Router), con PostgreSQL como única fuente de verdad y una PWA para el punto de venta con operación offline. Sin microservicios: los módulos se separan por carpetas y contratos, no por procesos. Cuando el volumen lo exija, un módulo (por ejemplo sincronización o reportes) puede extraerse sin reescribir el resto.

```
┌────────────────────────────────────────────────────────────────┐
│  Navegador / PWA (computadora, tableta, celular)               │
│  React Server Components + componentes cliente                  │
│  POS: IndexedDB (catálogo local, ventas pendientes, cola sync)  │
│  Service Worker: caché de app y cola de sincronización          │
└──────────────┬───────────────────────────────┬──────────────────┘
               │ Server Actions (mutaciones)   │ /api/v1 (JSON: sync, integraciones)
┌──────────────▼───────────────────────────────▼──────────────────┐
│  Next.js (Node runtime)  —  src/server                          │
│  context  → sesión, tenant, empresa, sucursal, permisos         │
│  authz    → catálogo de permisos, guardas                       │
│  audit    → bitácora                                            │
│  modules/ → companies, branches, users, roles, settings (F2)    │
│             catalog, inventory, pos, cash, sync (F3)            │
│             purchases, customers, promotions, returns (F4)      │
│             channels, invoicing, reports, loyalty (F5)          │
│  adapters/→ payments, invoicing, messaging, storage, hardware   │
│  jobs/    → colas y tareas programadas (reportes, reintentos)   │
└──────────────┬──────────────────────────────────────────────────┘
               │ Drizzle ORM (pg)
┌──────────────▼──────────────────────────────────────────────────┐
│  PostgreSQL 16/17 (Supabase en producción, Docker en local)     │
│  Libro de inventario inmutable · bitácora · sesiones            │
└─────────────────────────────────────────────────────────────────┘
```

## 2. Stack y por qué

| Capa | Elección | Motivo |
| --- | --- | --- |
| Lenguaje | TypeScript estricto | Un solo lenguaje en cliente, servidor, pruebas y migraciones. |
| Web | Next.js 15 (App Router), React 19 | SSR para pantallas administrativas, componentes cliente para el POS, Server Actions para mutaciones con validación en servidor, despliegue directo en Vercel. |
| Estilos | Tailwind CSS 4, iconos lucide | Diseño consistente, modo claro/oscuro por tokens CSS, sin runtime de estilos. |
| Base de datos | PostgreSQL (Supabase) | Transacciones, restricciones, índices parciales, `bigint` para dinero, JSONB para atributos variables. |
| ORM | Drizzle ORM + drizzle-kit | TypeScript puro, migraciones SQL versionadas y legibles, consultas tipadas. Ver ADR-001 (sustituye a Prisma). |
| Validación | zod | Esquemas compartidos entre formularios y servidor. |
| Auth | Propia: bcryptjs (coste 12) + sesiones opacas en BD + cookie httpOnly/SameSite=Lax | Control total de roles y tenants; sin dependencia de proveedor. Ver ADR-003. |
| Offline | PWA + Service Worker + IndexedDB | Catálogo local y cola idempotente (F3). |
| Pruebas | Vitest (unitarias e integración con Postgres real) | Rápido, compatible con TS y ESM. |
| Contenedores | Docker Compose (Postgres local) y Dockerfile de la app | Reproducibilidad en cualquier máquina. |
| Colas/tareas | Tabla `jobs` en Postgres procesada por un worker (F3+); cron de Vercel para tareas programadas | Evita infraestructura adicional al inicio; sustituible por una cola externa. |

## 3. Estructura de carpetas

```
sistema-caja/
├─ docs/                     especificación (esta carpeta) y ADRs
├─ drizzle/                  migraciones SQL generadas y versionadas
├─ scripts/                  seed, utilidades de operación
├─ src/
│  ├─ app/                   rutas Next.js
│  │  ├─ (auth)/login        inicio de sesión
│  │  ├─ (app)/              área autenticada (layout con navegación)
│  │  │  ├─ page.tsx         inicio
│  │  │  ├─ empresas/ sucursales/ usuarios/ roles/ configuracion/ bitacora/
│  │  │  └─ plataforma/      solo superadministrador
│  │  └─ api/                /api/health, /api/v1/*
│  ├─ components/            ui/ (botones, campos, tablas, diálogos), layout/
│  ├─ lib/                   utilidades puras (dinero, fechas, ids, texto)
│  └─ server/
│     ├─ db/                 cliente drizzle, schema/ (una tabla por archivo lógico)
│     ├─ auth/               contraseñas, sesiones, usuario actual
│     ├─ authz/              permisos, roles del sistema, guardas
│     ├─ audit/              escritura y consulta de bitácora
│     ├─ context.ts          RequestContext (tenant, empresa, sucursal, usuario, permisos)
│     ├─ errors.ts           errores de dominio → mensajes accionables
│     └─ modules/<modulo>/   actions.ts (mutaciones), queries.ts (lecturas), validation.ts (zod)
└─ tests/                    unit/ e integration/
```

Reglas entre módulos: un módulo importa de `db`, `authz`, `audit`, `context` y de los **índices públicos** de otros módulos (`modules/x/index.ts`), nunca de sus archivos internos. Las tablas se definen en `db/schema` para que las relaciones sean explícitas en un solo lugar.

## 4. Petición típica (mutación)

1. El formulario envía un Server Action con datos tipados.
2. `getRequestContext()` lee la cookie, carga la sesión y el usuario, resuelve empresa y sucursal activas, calcula permisos efectivos (rol ∩ módulos activos).
3. `requirePermission(ctx, "users.manage")` lanza `ForbiddenError` si falta.
4. zod valida la entrada; errores de campo regresan al formulario sin excepción.
5. Dentro de una transacción: regla de negocio, escritura, `audit.record()` con `before/after`.
6. `revalidatePath` y respuesta tipada `{ ok: true, data } | { ok: false, error, fieldErrors }`.

Las lecturas usan `queries.ts` desde Server Components con el mismo contexto; nunca se consulta una tabla sin `tenant_id`.

## 5. Multiempresa y aislamiento

- `tenant_id` en toda tabla de negocio; `company_id` en toda tabla operativa; `branch_id` donde aplique.
- Claves únicas compuestas (`tenant_id, company_id, codigo`) para SKU, códigos de sucursal, folios.
- El contexto fija el tenant desde la sesión, nunca desde la URL o el formulario. Los identificadores que llegan del cliente se validan contra el tenant del contexto.
- Preparado para Row Level Security de Postgres en una fase posterior (la variable de sesión `app.tenant_id` se puede activar sin cambiar el código de módulos).

## 6. Dinero, fechas e identificadores

- Importes en **centavos enteros** (`bigint`), moneda ISO 4217 por empresa; conversión a decimal solo al mostrar. Impuestos calculados por línea con redondeo bancario a la unidad mínima de la moneda; totales como suma de líneas.
- Fechas en `timestamptz` UTC; la zona horaria de empresa/sucursal se aplica al mostrar y al calcular "día de venta" y cortes.
- Identificadores `uuid` (v7 cuando los genere el cliente offline; v4/v7 en servidor). Los registros creados offline conservan su id para idempotencia.

## 7. Offline y sincronización (diseño, se implementa en F3)

- Catálogo, precios, promociones y configuración se replican a IndexedDB por sucursal con versión incremental (`updated_at` + borrado lógico).
- Cada venta offline genera `sale.id` (uuid v7) y un `client_sequence` por caja; la cola envía lotes en orden; el servidor aplica `INSERT ... ON CONFLICT (id) DO NOTHING` y responde el estado por elemento (`applied`, `duplicate`, `conflict`, `rejected`).
- Conflictos típicos: precio distinto al actual (se respeta el cobrado y se marca), producto desactivado (se acepta y se alerta), inventario negativo (permitido con alerta si la empresa lo configura).
- Funciones que dependen de terceros (facturación, pagos en línea, pedidos externos) se marcan "pendiente" y se procesan al reconectar.
- El Service Worker cachea la aplicación (app shell) y nunca respuestas de datos sensibles.

## 8. Integraciones por adaptador

Cada integración define una interfaz en `src/server/adapters/<tipo>/types.ts` y al menos dos implementaciones: real (según proveedor) y `sandbox` (identificada en interfaz y en logs). La implementación activa se elige por variable de entorno (`PAYMENTS_PROVIDER=sandbox`). Nunca se simula un resultado de proveedor sin marcarlo.

| Tipo | Interfaz mínima |
| --- | --- |
| Pagos | `authorize`, `capture`, `refund`, `status`, webhooks |
| Facturación | `stamp`, `cancel`, `download(xml|pdf)`, `validateTaxId` |
| Mensajería | `sendEmail`, `sendSms`, `sendWhatsApp` |
| Archivos | `put`, `getSignedUrl`, `delete` |
| Hardware | impresión ESC/POS vía WebUSB/WebSerial o servicio local; cajón; báscula; lector (teclado HID) |
| Canales | `pullOrders`, `pushStock`, `pushPrices`, `updateOrderStatus` |

## 9. Seguridad

- Contraseñas: bcrypt coste 12, política mínima 8 caracteres, bloqueo temporal tras 5 intentos fallidos en 15 minutos.
- Sesión: token aleatorio de 32 bytes, almacenado como SHA-256 en BD, cookie `httpOnly`, `Secure` en producción, `SameSite=Lax`; renovación deslizante; revocación por usuario.
- CSRF: Server Actions verifican origen; la API JSON exige encabezado `Authorization` o token de integración y no acepta cookies para mutaciones.
- Entradas: zod en todas las acciones; consultas parametrizadas vía Drizzle; sin SQL concatenado.
- XSS: React escapa por defecto; se prohíbe `dangerouslySetInnerHTML` salvo en el renderizado de tickets con sanitización.
- Encabezados: CSP básica, `X-Frame-Options`, `Referrer-Policy`, HSTS en producción.
- Secretos solo en variables de entorno; `.env.example` sin valores reales.
- Datos personales: campos de consentimiento por canal; exportación y borrado lógico de clientes; retención configurable por empresa (F5).
- Respaldos: Supabase (PITR según plan) + `scripts/backup.sh` con `pg_dump` para entornos propios.

## 10. Observabilidad

- Registro estructurado (JSON) con `request_id`, `tenant_id`, `user_id`.
- Tabla `audit_log` para acciones críticas; `error_log` para fallos de sincronización e integraciones.
- `/api/health` verifica base de datos y migraciones aplicadas.

## 11. Despliegue

- Local: `docker compose up db` + `npm run dev`.
- Producción: Vercel (app) + Supabase (Postgres). Migraciones con `npm run db:migrate` en el paso de build o en un job previo al despliegue; nunca automáticas en tiempo de petición.
- Entornos: `development`, `preview` (ramas) y `production`, cada uno con su `DATABASE_URL`.
