"use client";

import { createContext, useActionState, useContext, useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/server/errors";
import { Alert, Button, cx } from "./index";

export type FormAction = (prev: ActionResult<unknown> | null, formData: FormData) => Promise<ActionResult<unknown>>;

const FormCtx = createContext<{ fieldErrors: Record<string, string[]> }>({ fieldErrors: {} });

/**
 * Formulario conectado a una acción de servidor. Muestra el error general y
 * entrega los errores por campo a los <FormField> hijos.
 */
export function AppForm({
  action,
  children,
  className,
  successMessage = "Guardado correctamente.",
  onSuccess,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  successMessage?: string | null;
  onSuccess?: (data: unknown) => void;
}) {
  const [state, formAction] = useActionState(action, null);
  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  useEffect(() => {
    if (state?.ok && onSuccess) onSuccess(state.data);
  }, [state, onSuccess]);
  return (
    <FormCtx.Provider value={{ fieldErrors }}>
      <form action={formAction} className={cx("space-y-4", className)} noValidate>
        {state && !state.ok && (
          <Alert tone="danger" title={state.error}>
            {fieldErrors._ && fieldErrors._.join(" ")}
          </Alert>
        )}
        {state?.ok && successMessage && <Alert tone="success">{successMessage}</Alert>}
        {children}
      </form>
    </FormCtx.Provider>
  );
}

export function FormField({ name, label, hint, children, required }: { name: string; label: string; hint?: string; children: ReactNode; required?: boolean }) {
  const { fieldErrors } = useContext(FormCtx);
  const errors = fieldErrors[name];
  return (
    <div className="space-y-1">
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
        {required && <span className="text-danger"> *</span>}
      </label>
      {children}
      {errors ? (
        <p className="text-xs text-danger" id={`${name}-error`}>
          {errors.join(" ")}
        </p>
      ) : (
        hint && <p className="text-xs text-muted">{hint}</p>
      )}
    </div>
  );
}

export function useFieldError(name: string) {
  return useContext(FormCtx).fieldErrors[name];
}

export function Input({ name, className, ...props }: ComponentProps<"input"> & { name: string }) {
  const err = useFieldError(name);
  return <input id={name} name={name} className={cx("field", err && "field-error", className)} aria-invalid={!!err} {...props} />;
}

export function Select({ name, className, children, ...props }: ComponentProps<"select"> & { name: string }) {
  const err = useFieldError(name);
  return (
    <select id={name} name={name} className={cx("field", err && "field-error", className)} aria-invalid={!!err} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({ name, label, hint, ...props }: ComponentProps<"input"> & { name: string; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-app border border-border px-3 py-2.5 hover:bg-surface-2">
      <input type="checkbox" name={name} className="mt-1 size-4 accent-primary" {...props} />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function SubmitButton({ children, variant = "primary", pendingText = "Guardando…", ...props }: ComponentProps<typeof Button> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} {...props}>
      {pending ? pendingText : children}
    </Button>
  );
}

/**
 * Botón que pide confirmación (y opcionalmente un motivo) antes de ejecutar
 * una acción de servidor. Para desactivar, suspender, restablecer, etc.
 */
export function ConfirmAction({
  action,
  label,
  confirmTitle,
  confirmText,
  requireReason = false,
  variant = "secondary",
  hiddenFields = {},
  onDone,
}: {
  action: FormAction;
  label: string;
  confirmTitle: string;
  confirmText?: string;
  requireReason?: boolean;
  variant?: ComponentProps<typeof Button>["variant"];
  hiddenFields?: Record<string, string>;
  onDone?: (data: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, null);
  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      onDone?.(state.data);
    }
  }, [state, onDone]);
  return (
    <>
      <Button type="button" variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <form action={formAction} className="w-full max-w-md space-y-4 rounded-app border border-border bg-surface p-5 shadow-xl">
            <h2 id="confirm-title" className="text-lg font-semibold">
              {confirmTitle}
            </h2>
            {confirmText && <p className="text-sm text-muted">{confirmText}</p>}
            {state && !state.ok && <Alert tone="danger">{state.error}</Alert>}
            {Object.entries(hiddenFields).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            {requireReason && (
              <div className="space-y-1">
                <label htmlFor="reason" className="block text-sm font-medium">
                  Motivo <span className="text-danger">*</span>
                </label>
                <input id="reason" name="reason" className="field" required minLength={3} autoFocus />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <SubmitButton variant={variant === "danger" ? "danger" : "primary"} pendingText="Procesando…">
                Confirmar
              </SubmitButton>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
