import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { getRequestContext, type RequestContext } from "@/server/context";
import { DomainError, ValidationError } from "@/server/errors";

/** Encabezado obligatorio en las llamadas del cliente propio (defensa CSRF). */
export const CLIENT_HEADER = "x-sc-client";

export type ApiError = { ok: false; error: string; code: string; fieldErrors?: Record<string, string[]> };

export function apiError(status: number, code: string, error: string, fieldErrors?: Record<string, string[]>) {
  return NextResponse.json<ApiError>({ ok: false, code, error, ...(fieldErrors ? { fieldErrors } : {}) }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Envuelve un handler de la API JSON:
 * - exige sesión válida (cookie httpOnly);
 * - en mutaciones exige el encabezado `x-sc-client` y que el Origin, si viene,
 *   sea el mismo sitio (un sitio ajeno no puede enviar encabezados propios sin
 *   CORS, que no habilitamos);
 * - convierte errores de dominio en respuestas con mensaje accionable.
 */
export function withApi<P = Record<string, string>>(
  handler: (req: NextRequest, ctx: RequestContext, params: P) => Promise<unknown>,
) {
  return async (req: NextRequest, route: { params: Promise<P> }) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        if (req.headers.get(CLIENT_HEADER) !== "pos") return apiError(403, "forbidden", "Solicitud no permitida.");
        const origin = req.headers.get("origin");
        if (origin && new URL(origin).host !== req.headers.get("host")) return apiError(403, "forbidden", "Origen no permitido.");
      }
      const ctx = await getRequestContext();
      if (!ctx) return apiError(401, "unauthenticated", "Tu sesión expiró. Inicia sesión de nuevo.");
      const data = await handler(req, ctx, await route.params);
      return NextResponse.json({ ok: true, data }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      if (err instanceof ValidationError) return apiError(err.status, err.code, err.message, err.fieldErrors);
      if (err instanceof DomainError) return apiError(err.status, err.code, err.message);
      if (err instanceof SyntaxError) return apiError(400, "bad_request", "Cuerpo de la solicitud inválido.");
      console.error("[api]", err);
      return apiError(500, "internal", "Ocurrió un error inesperado. Intenta de nuevo.");
    }
  };
}
