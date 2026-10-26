# ADR-003 · Autenticación propia con sesiones en base de datos

Fecha: 2026-10-26 · Estado: aceptada

## Contexto
El prompt exige inicio de sesión con usuario y contraseña, roles por empresa, auditoría con dispositivo y autorización en caliente de otro usuario (descuentos, cancelaciones). Los proveedores de identidad (Supabase Auth, NextAuth con OAuth) añaden dependencias y acoplan el modelo de usuario.

## Decisión
- Usuarios en tabla propia con `bcryptjs` (coste 12).
- Sesiones opacas: token aleatorio de 32 bytes entregado en cookie `sc_session` (httpOnly, SameSite=Lax, Secure en producción); en base de datos se guarda solo su SHA-256, con expiración deslizante (12 h de inactividad) y absoluta (30 días), IP, agente y dispositivo.
- Bloqueo temporal tras 5 intentos fallidos en 15 minutos; respuesta genérica para no revelar usuarios.
- Autorización en caliente: verificación de credenciales de un tercero sin crear sesión.
- Preparado para MFA y tokens de integración (`integration_tokens`) sin cambiar el modelo.

## Consecuencias
- Control total y sin costo por usuario activo.
- Responsabilidad propia de la seguridad: pruebas de integración obligatorias para login, bloqueo, revocación y aislamiento.
