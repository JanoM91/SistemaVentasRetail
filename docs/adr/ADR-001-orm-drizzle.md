# ADR-001 · ORM: Drizzle en lugar de Prisma

Fecha: 2026-10-26 · Estado: aceptada (por el equipo de desarrollo; revisable por Jano)

## Contexto
El prompt maestro recomienda Prisma ORM "si el proyecto no tiene una tecnología definida". Prisma (versiones 6 y 7) descarga binarios del motor de esquema desde `binaries.prisma.sh` durante la instalación y en cada comando `migrate`. Ese host está bloqueado en el entorno donde se construyó la base técnica, por lo que no era posible generar ni aplicar migraciones.

## Decisión
Usar Drizzle ORM (`drizzle-orm`) con `drizzle-kit` para migraciones y el driver `pg`. El esquema se define en TypeScript (`src/server/db/schema/*.ts`); `drizzle-kit generate` produce migraciones SQL legibles y versionadas en `drizzle/`; `drizzle-kit migrate` las aplica.

## Consecuencias
- Positivas: sin binarios nativos; migraciones en SQL plano auditables; consultas tipadas y cercanas a SQL; funciona igual en local, Supabase y Vercel.
- Negativas: menos "mágico" que Prisma (las relaciones se escriben explícitas); el equipo debe aprender su API.
- Reversible: como las migraciones son SQL estándar, migrar a Prisma más adelante implica reescribir el esquema y las consultas, no la base de datos.
