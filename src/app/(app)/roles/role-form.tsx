"use client";

import { ButtonLink } from "@/components/ui";
import { AppForm, FormField, Input, SubmitButton, type FormAction } from "@/components/ui/form";

export type PermissionGroup = { area: string; label: string; items: Array<{ code: string; label: string; grantable: boolean }> };

export function RoleForm({ action, groups, values = {}, mode, readOnly = false }: { action: FormAction; groups: PermissionGroup[]; mode: "create" | "edit"; readOnly?: boolean; values?: { id?: string; key?: string; name?: string; description?: string | null; permissions?: string[] } }) {
  const selected = new Set(values.permissions ?? []);
  return (
    <AppForm action={action} successMessage={mode === "edit" ? "Rol actualizado." : null}>
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        {mode === "create" ? (
          <FormField name="key" label="Clave" required hint="Identificador técnico, p. ej. supervisor."><Input name="key" autoCapitalize="none" /></FormField>
        ) : (
          <FormField name="key" label="Clave"><Input name="key_display" defaultValue={values.key} disabled /></FormField>
        )}
        <FormField name="name" label="Nombre" required><Input name="name" defaultValue={values.name} disabled={readOnly} /></FormField>
        <div className="sm:col-span-2">
          <FormField name="description" label="Descripción"><Input name="description" defaultValue={values.description ?? ""} disabled={readOnly} /></FormField>
        </div>
      </div>
      <div className="space-y-3">
        <p className="text-sm font-medium">Permisos</p>
        <p className="text-xs text-muted">Solo puedes otorgar permisos que tú tienes; los demás aparecen deshabilitados. Los permisos de módulos apagados se activan cuando enciendas el módulo.</p>
        <div className="grid gap-3 md:grid-cols-2">
          {groups.map((g) => (
            <fieldset key={g.area} className="rounded-app border border-border p-3">
              <legend className="px-1 text-sm font-semibold">{g.label}</legend>
              <div className="grid gap-1">
                {g.items.map((p) => (
                  <label key={p.code} className={`flex items-center gap-2 rounded px-1 py-1 text-sm ${p.grantable && !readOnly ? "cursor-pointer hover:bg-surface-2" : "opacity-60"}`}>
                    <input type="checkbox" name="permissions[]" value={p.code} defaultChecked={selected.has(p.code)} disabled={!p.grantable || readOnly} className="accent-primary" />
                    <span>{p.label}</span>
                    <code className="ml-auto text-[10px] text-muted">{p.code}</code>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </div>
      {!readOnly && (
        <div className="flex gap-2">
          <SubmitButton>{mode === "create" ? "Crear rol" : "Guardar cambios"}</SubmitButton>
          <ButtonLink variant="ghost" href="/roles">Cancelar</ButtonLink>
        </div>
      )}
    </AppForm>
  );
}
