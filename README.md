# Sistema de Caja

Plataforma SaaS de gestión comercial para negocios retail: punto de venta, inventario, clientes, promociones y analítica, multiempresa y preparada para operar sin internet. Producto de Exkalibur Consulting (nombre comercial pendiente).

**Estado: Fase 4 completa — operación comercial (compras, clientes y crédito, devoluciones, promociones). Siguiente: Fase 5 (reportes, facturación, pedidos, lealtad).**

- **Fase 2 (base):** autenticación, cuentas (tenants), empresas, sucursales, almacenes, cajas, usuarios, roles y permisos, módulos activables, configuración y bitácora.
- **Fase 3 (vender):** catálogo con variantes y códigos de barras, inventario con libro inmutable y costo promedio, caja con cortes X y Z, punto de venta táctil con ticket de 80 mm, venta **sin internet** con sincronización sin duplicados, app instalable (PWA).
- **Fase 4A (comprar y mover):** proveedores, órdenes de compra con autorización, recepción parcial con flete prorrateado al costo, compra directa, devolución a proveedor con nota de crédito, cuentas por pagar, sugerencias de compra, traspasos entre sucursales con tránsito y conteo físico.
- **Fase 4B (clientes y crédito):** ficha de clientes con datos fiscales, grupos y segmentos; cliente en la venta y alta rápida desde caja; cobro con varios métodos; venta a crédito con límite y autorización; abonos en caja que entran al corte; estado de cuenta y cuentas por cobrar por antigüedad.
- **Fase 4C (devoluciones):** devoluciones parciales o totales con y sin ticket, cambios con vale, reembolso en efectivo, al medio original, a cuenta o con vale, política configurable.
- **Fase 4D (promociones):** motor de promociones compartido POS/servidor con explicación en el ticket, cupones, listas de precios por grupo, métodos de pago e impuestos editables y revisión de ventas con observaciones. Reporte de la fase en `docs/13-entrega-fase-4.md`.

## Stack

TypeScript · Next.js 15 (App Router, Server Actions) · React 19 · Tailwind CSS 4 · PostgreSQL 16/17 · Drizzle ORM + drizzle-kit · zod · bcryptjs · Vitest · Playwright (E2E) · Docker.

La especificación completa está en `docs/` (01 a 09) y las decisiones de arquitectura en `docs/adr/`.

## Requisitos

- Node.js 22 o superior y npm.
- PostgreSQL 16 o superior (local, en Docker o Supabase).

## Instalación local (5 pasos)

```bash
# 1. Código y dependencias
git clone https://github.com/JanoM91/SistemaVentasRetail.git
cd SistemaVentasRetail
npm install

# 2. Base de datos local en Docker (o usa tu propio Postgres)
docker compose up -d db

# 3. Variables de entorno
cp .env.example .env            # DATABASE_URL ya apunta al Postgres de Docker

# 4. Migraciones y datos de prueba
npm run db:migrate
npm run db:seed

# 5. Servidor de desarrollo
npm run dev                      # http://localhost:3000
```

Resultado esperado: en `http://localhost:3000/login` puedes entrar con las credenciales de demostración. Si ves "Falta DATABASE_URL", revisa el paso 3; si ves un error de conexión, confirma que Postgres está arriba (`docker compose ps`).

### Credenciales de demostración

| Usuario | Contraseña | Rol | Cuenta |
| --- | --- | --- | --- |
| `superadmin` | `Admin1234!` | Superadministrador (plataforma) | plataforma |
| `dueno` | `Dueno1234!` | Dueño | demo |
| `gerente` | `Gerente1234!` | Gerente (solo Sucursal Centro) | demo |
| `cajero` | `Cajero1234!` | Cajero (solo Sucursal Centro) | demo |

Las semillas cargan además un catálogo demo (bebidas, botanas, abarrotes, granel y una playera con tallas y colores) con existencias en «Sucursal Centro», y tres proveedores ligados a esos productos (Distribuidora del Golfo, Abarrotes Mayoreo Xalapa, Textiles del Centro) con los módulos de compras, devoluciones, promociones y crédito activos, y cuatro clientes (dos con crédito) en los grupos Mayoreo y Empleados. Para vender: entra como `cajero`, abre la caja en **Caja** y ve a **Punto de venta**; prueba escanear `7500000000011`. Para comprar: entra como `gerente` → **Compras** → **Sugerencias** o **Nueva orden**. Para fiar: en el POS agrega a «Tienda La Esquina» (crédito de $2,000) y cobra con «Crédito del cliente»; como `cajero` te pedirá autorización (`gerente`). Promociones demo: 3x2 en galletas, jugo a $28 entre semana de 7 a 11 h, cupón `BIENVENIDA10` y lista Mayoreo (arroz y frijol) para el grupo Mayoreo.

Estas contraseñas son públicas (el repositorio es público). **Nunca siembres un entorno real con ellas:** define `SEED_*_PASSWORD` propias antes de `npm run db:seed`.

## Scripts

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo. |
| `npm run build` / `npm start` | Compila y sirve en producción. |
| `npm run typecheck` | Verifica tipos con TypeScript. |
| `npm run lint` | ESLint. |
| `npm test` | Pruebas unitarias e integración (necesita `TEST_DATABASE_URL` en `.env.test`; la base se vacía en cada corrida). |
| `npm run test:e2e` | Recorridos extremo a extremo con Playwright contra un servidor en marcha (`BASE_URL`, por defecto `http://localhost:3100`) y una base recién sembrada (`npm run db:reset`): POS en línea y sin conexión, sincronización y corte Z; administración; compras, traspasos y conteo; clientes, crédito y abonos; devoluciones y cambios; promociones, cupones y listas de precios; reportes y exportaciones. |
| `npm run stock:verify` | Recalcula existencias desde el libro de inventario y las compara con los saldos (sale con código 1 si hay diferencias). |
| `npm run check` | typecheck + lint + test + build. |
| `npm run db:generate` | Genera una migración SQL a partir de los cambios en `src/server/db/schema`. |
| `npm run db:migrate` | Aplica migraciones pendientes. |
| `npm run db:seed` | Siembra roles, monedas, tenant de plataforma y tenant demo (idempotente). |
| `npm run db:reset` | Vacía la base local, migra y siembra (solo desarrollo). |
| `npm run db:studio` | Explorador de datos de Drizzle. |

## Estructura

```
docs/            especificación (fase 1) y ADRs
drizzle/         migraciones SQL versionadas
scripts/         seed y utilidades
src/app/         rutas Next.js: (auth)/login, (app)/* (administración), (pos)/pos (punto de venta),
                 (print)/ticket, api/v1/* (JSON del POS y sincronización)
src/lib/pos/     almacenamiento local (IndexedDB) y motor de sincronización del POS
public/sw.js     service worker (abre el POS sin conexión)
src/components/  ui/ (botones, formularios, tablas) y layout/ (navegación)
src/server/      db/ (esquema), auth/, authz/ (permisos), audit/, modules/* (servicios)
tests/           unit/, integration/ (Postgres real), e2e/ (Playwright)
```

Cómo fluye una mutación: formulario → Server Action (`src/app/**/actions.ts`) → servicio del módulo (`src/server/modules/*/service.ts`) que valida permisos con `requirePermission`, valida datos con zod, escribe en una transacción y registra en la bitácora. Las páginas leen con el mismo contexto (`requirePagePermission`). Detalles en `docs/04-arquitectura.md`.

## Despliegue (Supabase + Vercel)

1. Crea un proyecto en Supabase y copia las dos cadenas de conexión: pooler (puerto 6543) y directa (5432).
2. En Vercel, importa el repositorio y define las variables: `DATABASE_URL` (pooler, añade `?pgbouncer=true`), `DIRECT_DATABASE_URL` (directa), `DATABASE_SSL=true`, `SESSION_IDLE_HOURS`, `SESSION_MAX_DAYS`.
3. Aplica migraciones y semillas desde tu máquina apuntando a Supabase: `DIRECT_DATABASE_URL=... DATABASE_URL=... DATABASE_SSL=true npm run db:migrate && npm run db:seed` (con contraseñas `SEED_*` propias).
4. Despliega. `GET /api/health` debe responder `{"ok":true,"database":"up"}`.

También puedes ejecutar la app en cualquier host con Docker: `docker compose --profile app up --build`.

## Punto de venta sin conexión

El POS guarda en el dispositivo la pantalla, el catálogo de la sucursal y una cola de ventas. Sin internet se puede vender en efectivo (incluso recargando la página); el ticket sale con folio «PENDIENTE» y al volver la red las ventas se envían solas. El servidor reconoce cada venta por su identificador, así que reintentos o envíos repetidos nunca la duplican. Lo que no cuadra (precio cambiado, inventario negativo, turno ya cerrado) se registra y queda marcado en **Ventas → Con observaciones**. Detalles en `docs/adr/ADR-004-venta-offline-idempotente.md`.

Para usarlo como app: iPhone → Safari → Compartir → «Agregar a pantalla de inicio»; Android → Chrome → ⋮ → «Instalar app». Ábrelo una vez con internet en cada dispositivo para que quede disponible sin conexión.

## Compras e inventario entre sucursales

- **Orden de compra:** se guarda como borrador; quien tiene «Autorizar compras» la envía y ya no se edita. Se recibe en una o varias entregas; si el proveedor no completa, se cierra con faltantes.
- **Costo:** los costos se capturan **sin IVA**. Flete, maniobras u otros cargos se reparten entre los productos según su valor, y ese costo final alimenta el costo promedio y la utilidad.
- **Cuentas por pagar:** cada recepción crea su cuenta con vencimiento según los días de crédito del proveedor; admite pagos parciales y las devoluciones se abonan como nota de crédito.
- **Traspasos:** la mercancía sale del origen al enviar y queda en tránsito; solo la sucursal destino confirma lo que llegó y los faltantes quedan en la bitácora.
- **Conteo físico:** quien cuenta no ve la existencia del sistema; el supervisor revisa diferencias y las aplica como ajuste. Se puede seguir vendiendo durante el conteo.

## Clientes y crédito

- **En caja:** «Agregar cliente» busca por nombre, teléfono, correo o RFC, o da de alta uno nuevo con nombre y teléfono. Sin internet solo se puede escribir el nombre para el ticket.
- **Cobro dividido:** se agregan pagos parciales (p. ej. $200 en tarjeta y el resto en efectivo); solo el efectivo da cambio.
- **Venta a crédito:** aparece «Crédito del cliente» si el cliente tiene crédito autorizado. Pide autorización de gerente si el vendedor no tiene el permiso «Vender a crédito», si excede el disponible o si el cliente tiene saldo vencido. El ticket incluye línea de firma. Sin internet no se vende a crédito.
- **Abonos:** botón «Abono» en el punto de venta; el efectivo entra al corte del turno. Transferencias y tarjeta también se registran en la ficha del cliente.
- **Estado de cuenta:** inmutable; los abonos se aplican a lo más antiguo y **Clientes → Por cobrar** muestra la antigüedad (al corriente, 1–30, 31–60, 61–90, +90 días).

## Devoluciones y cambios

- En el punto de venta: **Devolución** → folio del ticket (p. ej. `V-000123`) → cuánto regresa de cada producto y si vuelve al inventario o es merma → motivo → forma de reembolso.
- Se devuelve lo que el cliente pagó realmente (con descuentos), proporcional por pieza; nunca más de lo vendido.
- **Cambio:** se emite un vale con el valor devuelto y se aplica automáticamente al cobrar los productos nuevos; si sobra, el vale conserva el saldo. Los vales se canjean después con el método «Vale de devolución» y su folio.
- **Sin ticket:** solo con vale, a precio vigente, y con permiso o autorización.
- **Política** (Configuración → Devoluciones): días permitidos (30 por defecto; después se requiere autorización), aceptar o no sin ticket, y si el reembolso en efectivo requiere autorización (sí por defecto). El efectivo devuelto se resta del corte.
- Una venta con devoluciones ya no se puede cancelar.

## Promociones y precios

- **Promociones** (menú Promociones): porcentaje, monto por pieza, precio especial, 2x1/3x2, volumen, combos y descuentos al ticket; por producto o categoría, fechas, días, horario, sucursal, grupo de clientes, compra mínima y límites de uso. Se aplican solas en caja (también sin conexión) y el ticket explica cada ahorro.
- **No se acumulan** por defecto: cada producto recibe la de mayor prioridad. Se cambia en Configuración.
- **Cupones:** marca la promoción como «requiere cupón» y crea un código para todos (p. ej. `BIENVENIDA10`) o un lote de códigos de un solo uso. En caja: «Agregar cupón» (requiere conexión).
- **Listas de precios:** Promociones → Listas de precios; asígnala a un grupo en Clientes → Grupos. Al elegir un cliente del grupo, el POS cambia los precios.
- **Métodos de pago e impuestos:** Configuración (solo el dueño). Siempre debe quedar un efectivo activo.
- **Ventas → Por revisar:** ventas sin conexión que entraron con observaciones y envíos rechazados; se marcan revisadas con nota.

## Reportes

- **Menú Reportes** (gerente y dueño; el cajero no lo ve): resumen con indicadores comparados contra el periodo anterior, venta por día (o por hora si eliges un solo día), formas de pago, productos y categorías.
- **Pestañas:** Ventas (sucursal, forma de pago, vendedor, hora, día de la semana), Productos y utilidad, Inventario (valor, cobertura, sin movimiento), Clientes, Promociones, Cortes de caja.
- **Filtros:** periodo (hoy, ayer, 7 o 30 días, mes, mes anterior, año o «Fechas…» para un rango) y sucursal. Los días cortan a medianoche en la zona horaria de la empresa.
- **Exportar:** botones Excel, CSV y PDF con las mismas tablas que ves (`reports.export`). También por API: `GET /api/v1/reports/export?reporte=ventas&formato=xlsx&periodo=30d`.
- **Utilidad:** solo con `reports.view_profit`. Si vendiste productos sin costo registrado, su venta no se cuenta como utilidad y el reporte lo avisa como «incompleta».
- **Inicio** muestra la venta de hoy contra ayer para quien puede ver reportes.

## Seguridad (resumen)

Contraseñas con bcrypt (coste 12); sesiones opacas en base de datos con cookie httpOnly/SameSite=Lax; bloqueo temporal tras 5 intentos fallidos; permisos verificados en el servidor en cada acción; aislamiento por `tenant_id` en toda consulta; bitácora de acciones críticas; encabezados de seguridad; secretos solo en variables de entorno. Detalles en `docs/04-arquitectura.md` §9 y `docs/adr/ADR-003-autenticacion-propia.md`.

## Integración continua

Cada push a `main` y cada pull request ejecutan tipos, lint, pruebas (con un Postgres de servicio) y build en GitHub Actions (`.github/workflows/ci.yml`).

## Licencia

© Exkalibur Consulting. Todos los derechos reservados. El código es visible públicamente, pero no se concede licencia de uso, copia ni distribución.
