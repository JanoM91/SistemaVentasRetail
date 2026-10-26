# Sistema de Caja

Plataforma SaaS de gestión comercial para negocios retail: punto de venta, inventario, clientes, promociones y analítica, multiempresa y preparada para operar sin internet. Producto de Exkalibur Consulting (nombre comercial pendiente).

**Estado: Fase 2 — base técnica.** Incluye autenticación, cuentas (tenants), empresas, sucursales, almacenes, cajas, usuarios, roles y permisos, módulos activables, configuración y bitácora. El catálogo, el inventario y el POS llegan en la Fase 3 (ver `docs/09-roadmap.md`).

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

Estas contraseñas son públicas (el repositorio es público). **Nunca siembres un entorno real con ellas:** define `SEED_*_PASSWORD` propias antes de `npm run db:seed`.

## Scripts

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo. |
| `npm run build` / `npm start` | Compila y sirve en producción. |
| `npm run typecheck` | Verifica tipos con TypeScript. |
| `npm run lint` | ESLint. |
| `npm test` | Pruebas unitarias e integración (necesita `TEST_DATABASE_URL` en `.env.test`; la base se vacía en cada corrida). |
| `npm run test:e2e` | Recorrido extremo a extremo con Playwright contra un servidor en marcha (`BASE_URL`, por defecto `http://localhost:3100`). |
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
src/app/         rutas Next.js: (auth)/login, (app)/* (área autenticada), api/
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

## Seguridad (resumen)

Contraseñas con bcrypt (coste 12); sesiones opacas en base de datos con cookie httpOnly/SameSite=Lax; bloqueo temporal tras 5 intentos fallidos; permisos verificados en el servidor en cada acción; aislamiento por `tenant_id` en toda consulta; bitácora de acciones críticas; encabezados de seguridad; secretos solo en variables de entorno. Detalles en `docs/04-arquitectura.md` §9 y `docs/adr/ADR-003-autenticacion-propia.md`.

## Integración continua

Cada push a `main` y cada pull request ejecutan tipos, lint, pruebas (con un Postgres de servicio) y build en GitHub Actions (`.github/workflows/ci.yml`).

## Licencia

© Exkalibur Consulting. Todos los derechos reservados. El código es visible públicamente, pero no se concede licencia de uso, copia ni distribución.
