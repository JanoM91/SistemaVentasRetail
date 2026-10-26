# 10 · Reporte de entrega — Fases 1 y 2

Fecha: 2026-10-26 · Autor: equipo de desarrollo (IA) para Jano y Beto

## 1. Qué se entrega

**Fase 1 (especificación):** documentos `docs/01` a `docs/09` y tres ADR (`docs/adr/`). Copia en el Proyecto "Sistema de caja" de Claude (carpeta `especificacion/`).

**Fase 2 (base técnica):** aplicación Next.js funcional con:

| Área | Entregado |
| --- | --- |
| Autenticación | Usuario y contraseña, bcrypt, sesiones opacas en BD, cookie httpOnly, bloqueo tras 5 fallos, cambio de contraseña obligatorio con temporal, cierre de sesión, autorización en caliente de un tercero (servicio listo para el POS). |
| Cuentas (tenants) | Pantalla de plataforma para superadministrador: crear cuenta con empresa/sucursal/almacén/caja/dueño, suspender/reactivar, restablecer contraseña de dueño, activar módulos por empresa. |
| Empresas | Lista, alta (con estructura por defecto e impuestos/métodos de pago/canal/folios de México), edición, desactivación con motivo. |
| Sucursales, almacenes, cajas | Lista, alta, edición, desactivación; almacenes con "principal" único e inventario negativo opcional; cajas por sucursal. |
| Usuarios | Lista por empresa, alta con rol y sucursales, contraseña temporal mostrada una vez, edición, cambio de acceso, restablecimiento, desactivación con revocación de sesiones. Reglas: delegación (solo permisos propios y sucursales propias), último dueño, autoprotección. |
| Roles y permisos | Catálogo de 70 permisos en código, 4 roles del sistema (solo lectura), roles personalizados, duplicar rol, permisos efectivos = rol ∩ módulos activos. |
| Configuración | Datos y regional por empresa, módulos activables (12), parámetros (costeo, inventario negativo, promociones, POS, alertas), vista de impuestos, métodos de pago, canales y folios. |
| Bitácora | Registro de toda acción crítica con usuario, fecha, empresa, sucursal, IP, dispositivo, motivo y antes/después; consulta con filtros y paginación; solo lectura. |
| Navegación y diseño | Barra lateral filtrada por permisos y módulos, selector de empresa y sucursal, menú de usuario, modo claro/oscuro, responsive (escritorio, tableta, celular), textos en español, estados vacíos y errores accionables. |
| Infraestructura | Migración SQL inicial (18 tablas), semillas idempotentes, Docker Compose, Dockerfile, `.env.example`, `/api/health`, encabezados de seguridad. |
| Pruebas | 13 unitarias, 24 de integración contra Postgres real, recorrido E2E con Playwright (22 comprobaciones, con capturas). |

## 2. Archivos principales

```
docs/01-09 + adr/                 especificación y decisiones
drizzle/0000_init.sql             migración inicial
scripts/seed.ts, reset-db.ts      semillas y reinicio
src/server/db/schema/*.ts         esquema (organization, identity, audit, commerce-config)
src/server/authz/permissions.ts   catálogo de permisos (única fuente de verdad)
src/server/authz/system-roles.ts  roles del sistema
src/server/authz/resolve.ts       permisos efectivos y contexto
src/server/auth/*.ts              contraseñas, sesiones, cookies
src/server/audit/index.ts         bitácora
src/server/context.ts             contexto de la petición
src/server/modules/{auth,platform,companies,branches,users,roles,settings}
src/app/(auth)/login              inicio de sesión
src/app/(app)/*                   pantallas: inicio, empresas, sucursales, usuarios, roles, configuración, bitácora, plataforma, cambiar-contraseña
src/components/ui, layout         componentes base y navegación
tests/unit, integration, e2e      pruebas
README.md, .env.example, docker-compose.yml, Dockerfile
```

## 3. Pruebas ejecutadas

| Suite | Resultado |
| --- | --- |
| `npm run typecheck` | Sin errores. |
| `npm run lint` | Sin errores ni advertencias. |
| `npm test` (Vitest, Postgres 16 local) | 37/37 en verde: permisos y roles (13), autenticación (8), plataforma/empresas/sucursales/usuarios/roles/aislamiento (16). |
| `npm run build` | Compila; 20 rutas. |
| `npm run test:e2e` (Playwright, servidor de producción) | 22/22 comprobaciones: dueño (alta de sucursal, validación, alta de usuario con temporal, configuración, bitácora, roles solo lectura, plataforma denegada, modo oscuro, cambio obligatorio de contraseña), cajero en móvil (navegación filtrada, acceso denegado), superadministrador (alta de cuenta). Capturas en `tests/e2e/shots/`. |

## 4. Criterios de aceptación de la fase

AC-01 a AC-13 de `docs/07-criterios-de-aceptacion.md`: cubiertos (ver tabla ahí; cada uno apunta a su prueba o al procedimiento manual).

## 5. Problemas encontrados y cómo se resolvieron

1. **Prisma no pudo instalarse** en el entorno de construcción (descarga de binarios bloqueada). Se sustituyó por Drizzle ORM; documentado en ADR-001. En la máquina de Jano Prisma sí funcionaría, pero cambiar de ORM a mitad de camino costaría más que mantener Drizzle.
2. **Fuentes de Google bloqueadas** en el build. Se usan fuentes del sistema; además es mejor para la PWA offline y evita llamadas externas.
3. **Gerente con `branches.manage`**: el rol de sistema lo incluía por accidente y permitía crear sucursales; se corrigió y se añadió prueba.
4. **Delegación y módulos apagados**: el dueño no podía asignar el rol Cajero porque ese rol incluye permisos de módulos apagados (facturación, lealtad). La regla ahora ignora permisos de módulos inactivos al comparar. Prueba añadida.
5. **Errores de Postgres envueltos por Drizzle** (`cause`): el conversor de errores los desenvuelve para mostrar mensajes accionables ("ya existe un registro con ese código").

## 6. Supuestos tomados (resumen; detalle en `docs/01` §3)

Nombre provisional; Drizzle en lugar de Prisma; Supabase + Vercel; autenticación propia; superadministrador opera solo a nivel plataforma (para operar dentro de un negocio usa un usuario de ese negocio); dinero en centavos enteros; español como único idioma por ahora.

## 7. Pendientes y próximos pasos

**Decisiones de Jano**
- Nombre comercial y dominio.
- Confirmar o revertir Drizzle/Prisma (ADR-001) antes de que el esquema crezca en Fase 3.
- Cliente piloto para la Fase 3 y hardware que usa (impresora, lector).
- Repositorio: decidido el 2026-10-26 → https://github.com/JanoM91/SistemaVentasRetail (público). Las actualizaciones de cada fase se publican ahí.
- Supabase: creación autorizada por Jano; quedó pendiente la confirmación de costo que pide Supabase.
- Vercel: crear el proyecto conectado al repositorio una vez publicado el primer commit.

**Fase 3 (siguiente entrega)**, en este orden: catálogo con variantes y códigos → inventario con libro inmutable → caja (apertura, retiros, cortes) → POS online con venta en efectivo y ticket → PWA y catálogo local → ventas offline y cola de sincronización → pruebas de reenvío y conflictos.

**Mejoras técnicas pequeñas**
- Pruebas E2E dentro de CI (GitHub Actions con Postgres de servicio).
- Rate limiting por IP en el login (hoy es por usuario).
- Row Level Security en Postgres como segunda barrera (preparado en el diseño).
- Página de perfil (correo, tema persistente en servidor; hoy el tema se guarda en el navegador).
