import type { AuthzContext } from "@/server/authz/resolve";
import type { AuditActor } from "@/server/audit";

/**
 * Contexto mínimo que reciben los servicios de módulos. RequestContext lo
 * satisface; las pruebas lo construyen con resolveAuthz + un actor.
 */
export type ServiceContext = AuthzContext & { actor: AuditActor };

export function requireCompany(ctx: ServiceContext) {
  if (!ctx.company) {
    throw new Error("No hay una empresa activa en el contexto.");
  }
  return ctx.company;
}
