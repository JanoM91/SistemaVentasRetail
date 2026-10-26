"use client";

import { AppForm, FormField, Input, Select, SubmitButton, type FormAction } from "@/components/ui/form";
import { ButtonLink } from "@/components/ui";
import { CURRENCIES, DATE_FORMATS, LOCALES, TIMEZONES } from "@/server/modules/companies/validation";

export type CompanyFormValues = {
  id?: string;
  code?: string;
  legalName?: string;
  tradeName?: string;
  taxId?: string | null;
  taxRegime?: string | null;
  currency?: string;
  timezone?: string;
  locale?: string;
  dateFormat?: string;
  address?: Record<string, string | undefined>;
};

export function CompanyForm({ action, values = {}, mode }: { action: FormAction; values?: CompanyFormValues; mode: "create" | "edit" }) {
  const a = values.address ?? {};
  return (
    <AppForm action={action} successMessage={mode === "edit" ? "Empresa actualizada." : null}>
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        {mode === "create" ? (
          <FormField name="code" label="Código" required hint="Corto y único, p. ej. EMP2. No se puede cambiar después.">
            <Input name="code" defaultValue={values.code} maxLength={20} autoCapitalize="characters" />
          </FormField>
        ) : (
          <FormField name="code" label="Código">
            <Input name="code_display" defaultValue={values.code} disabled />
          </FormField>
        )}
        <FormField name="tradeName" label="Nombre comercial" required>
          <Input name="tradeName" defaultValue={values.tradeName} />
        </FormField>
        <FormField name="legalName" label="Razón social" required>
          <Input name="legalName" defaultValue={values.legalName} />
        </FormField>
        <FormField name="taxId" label="RFC / identificación fiscal">
          <Input name="taxId" defaultValue={values.taxId ?? ""} maxLength={20} />
        </FormField>
        <FormField name="taxRegime" label="Régimen fiscal (clave SAT)" hint="Ejemplo: 601, 612, 626.">
          <Input name="taxRegime" defaultValue={values.taxRegime ?? ""} maxLength={10} />
        </FormField>
        <FormField name="currency" label="Moneda" required>
          <Select name="currency" defaultValue={values.currency ?? "MXN"}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </FormField>
        <FormField name="timezone" label="Zona horaria" required>
          <Select name="timezone" defaultValue={values.timezone ?? "America/Mexico_City"}>
            {TIMEZONES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </FormField>
        <FormField name="locale" label="Idioma y región" required>
          <Select name="locale" defaultValue={values.locale ?? "es-MX"}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </Select>
        </FormField>
        <FormField name="dateFormat" label="Formato de fecha" required>
          <Select name="dateFormat" defaultValue={values.dateFormat ?? "dd/MM/yyyy"}>
            {DATE_FORMATS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </Select>
        </FormField>
      </div>
      <fieldset className="grid gap-4 rounded-app border border-border p-4 sm:grid-cols-3">
        <legend className="px-1 text-sm font-medium">Dirección fiscal</legend>
        <FormField name="address.street" label="Calle"><Input name="address.street" defaultValue={a.street} /></FormField>
        <FormField name="address.exteriorNumber" label="Número exterior"><Input name="address.exteriorNumber" defaultValue={a.exteriorNumber} /></FormField>
        <FormField name="address.interiorNumber" label="Número interior"><Input name="address.interiorNumber" defaultValue={a.interiorNumber} /></FormField>
        <FormField name="address.neighborhood" label="Colonia"><Input name="address.neighborhood" defaultValue={a.neighborhood} /></FormField>
        <FormField name="address.city" label="Ciudad"><Input name="address.city" defaultValue={a.city} /></FormField>
        <FormField name="address.state" label="Estado"><Input name="address.state" defaultValue={a.state} /></FormField>
        <FormField name="address.postalCode" label="Código postal"><Input name="address.postalCode" defaultValue={a.postalCode} inputMode="numeric" /></FormField>
        <FormField name="address.country" label="País (ISO)"><Input name="address.country" defaultValue={a.country ?? "MX"} maxLength={2} /></FormField>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <SubmitButton>{mode === "create" ? "Crear empresa" : "Guardar cambios"}</SubmitButton>
        <ButtonLink variant="ghost" href="/empresas">Cancelar</ButtonLink>
      </div>
    </AppForm>
  );
}
