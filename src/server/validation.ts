import type { z } from "zod";
import { ValidationError } from "./errors";

/** Valida con zod y convierte errores en ValidationError (errores por campo). */
export function parseOrThrow<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  throw new ValidationError(fieldErrors);
}

/** Convierte FormData a un objeto plano (campos repetidos → arreglo). */
export function formToObject(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value !== "string") continue;
    if (key.endsWith("[]")) {
      const k = key.slice(0, -2);
      if (Array.isArray(out[k])) (out[k] as string[]).push(value);
      else out[k] = [value];
    } else if (key.includes(".")) {
      const [a, b] = key.split(".", 2);
      ((out[a] ??= {}) as Record<string, unknown>)[b] = value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function checkbox(value: unknown): boolean {
  return value === "on" || value === "true" || value === true || value === "1";
}
