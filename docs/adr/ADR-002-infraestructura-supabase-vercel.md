# ADR-002 · Infraestructura: Supabase (Postgres) + Vercel (app)

Fecha: 2026-10-26 · Estado: aceptada (decisión de Jano)

## Contexto
Exkalibur ya opera varios proyectos en Supabase y Vercel; ambos están conectados a las sesiones de trabajo. El prompt pide Docker y variables de entorno.

## Decisión
Producción: base de datos Postgres gestionada en Supabase (solo la base; no se usa Supabase Auth ni sus políticas por ahora) y aplicación Next.js en Vercel. Desarrollo local: Postgres en Docker Compose. La aplicación no usa ninguna API específica de Supabase ni de Vercel; se conecta por `DATABASE_URL` estándar (puerto 6543 con pooler en Vercel, 5432 directo para migraciones).

## Consecuencias
- Portabilidad total a cualquier Postgres y a cualquier host Node/Docker (`Dockerfile` incluido).
- Hay que separar `DATABASE_URL` (pooler, transacciones) de `DIRECT_DATABASE_URL` (migraciones).
- Respaldos: los del plan de Supabase más `scripts/backup.sh`.
