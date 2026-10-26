/**
 * Errores de dominio. Las acciones de servidor los convierten en respuestas
 * tipadas; nunca se exponen trazas ni detalles internos al cliente.
 */
export class DomainError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = status;
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(message = "Tu sesión no es válida o expiró. Inicia sesión de nuevo.") {
    super("unauthenticated", message, 401);
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends DomainError {
  readonly permission?: string;
  constructor(permission?: string, message?: string) {
    super(
      "forbidden",
      message ??
        (permission
          ? `No tienes permiso para esta acción (${permission}).`
          : "No tienes permiso para esta acción."),
      403,
    );
    this.name = "ForbiddenError";
    this.permission = permission;
  }
}

/** Para recursos de otro tenant o inexistentes: nunca revela cuál de los dos. */
export class NotFoundError extends DomainError {
  constructor(entity = "El registro") {
    super("not_found", `${entity} no existe o no está disponible.`, 404);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends DomainError {
  readonly fieldErrors: Record<string, string[]>;
  constructor(fieldErrors: Record<string, string[]>, message = "Revisa los campos marcados.") {
    super("validation", message, 422);
    this.name = "ValidationError";
    this.fieldErrors = fieldErrors;
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super("conflict", message, 409);
    this.name = "ConflictError";
  }
}

/** Resultado estándar de una acción de servidor. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string; fieldErrors?: Record<string, string[]> };

export function toActionError(err: unknown): ActionResult<never> {
  if (err instanceof ValidationError) {
    return { ok: false, error: err.message, code: err.code, fieldErrors: err.fieldErrors };
  }
  if (err instanceof DomainError) {
    return { ok: false, error: err.message, code: err.code };
  }
  // Errores de Postgres (Drizzle los envuelve en `cause`): mensaje accionable sin detalles internos.
  const pgErr = ((err as { cause?: unknown })?.cause ?? err) as { code?: string; constraint?: string };
  if (pgErr?.code === "23505") {
    return {
      ok: false,
      error: "Ya existe un registro con ese código o identificador.",
      code: "conflict",
    };
  }
  if (pgErr?.code === "23503") {
    return {
      ok: false,
      error: "No se puede completar porque otros registros dependen de este.",
      code: "conflict",
    };
  }
  console.error("[action] error inesperado", err);
  return { ok: false, error: "Ocurrió un error inesperado. Intenta de nuevo.", code: "internal" };
}
