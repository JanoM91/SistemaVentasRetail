"use client";

import { AppForm, FormField, Input, Select, SubmitButton, type FormAction } from "@/components/ui/form";
import { ButtonLink } from "@/components/ui";
import { TIMEZONES } from "@/server/modules/companies/validation";

export function BranchForm({ action, values = {}, mode }: { action: FormAction; mode: "create" | "edit"; values?: { id?: string; code?: string; name?: string; phone?: string | null; email?: string | null; timezone?: string | null; address?: Record<string, string | undefined> } }) {
  const a = values.address ?? {};
  return (
    <AppForm action={action} successMessage={mode === "edit" ? "Sucursal actualizada." : null}>
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        {mode === "create" ? (
          <FormField name="code" label="Código" required hint="Corto y único dentro de la empresa, p. ej. NORTE.">
            <Input name="code" maxLength={20} autoCapitalize="characters" />
          </FormField>
        ) : (
          <FormField name="code" label="Código"><Input name="code_display" defaultValue={values.code} disabled /></FormField>
        )}
        <FormField name="name" label="Nombre" required><Input name="name" defaultValue={values.name} /></FormField>
        <FormField name="phone" label="Teléfono"><Input name="phone" defaultValue={values.phone ?? ""} inputMode="tel" /></FormField>
        <FormField name="email" label="Correo"><Input name="email" type="email" defaultValue={values.email ?? ""} /></FormField>
        <FormField name="timezone" label="Zona horaria" hint="Déjala vacía para usar la de la empresa.">
          <Select name="timezone" defaultValue={values.timezone ?? ""}>
            <option value="">(la de la empresa)</option>
            {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </FormField>
      </div>
      <fieldset className="grid gap-4 rounded-app border border-border p-4 sm:grid-cols-3">
        <legend className="px-1 text-sm font-medium">Dirección</legend>
        <FormField name="address.street" label="Calle"><Input name="address.street" defaultValue={a.street} /></FormField>
        <FormField name="address.exteriorNumber" label="Número"><Input name="address.exteriorNumber" defaultValue={a.exteriorNumber} /></FormField>
        <FormField name="address.neighborhood" label="Colonia"><Input name="address.neighborhood" defaultValue={a.neighborhood} /></FormField>
        <FormField name="address.city" label="Ciudad"><Input name="address.city" defaultValue={a.city} /></FormField>
        <FormField name="address.state" label="Estado"><Input name="address.state" defaultValue={a.state} /></FormField>
        <FormField name="address.postalCode" label="Código postal"><Input name="address.postalCode" defaultValue={a.postalCode} inputMode="numeric" /></FormField>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <SubmitButton>{mode === "create" ? "Crear sucursal" : "Guardar cambios"}</SubmitButton>
        <ButtonLink variant="ghost" href="/sucursales">Cancelar</ButtonLink>
      </div>
    </AppForm>
  );
}
