"use client";

import { useCallback, useState } from "react";
import { Alert, ButtonLink, Card } from "@/components/ui";
import { AppForm, Checkbox, ConfirmAction, FormField, Input, Select, SubmitButton } from "@/components/ui/form";
import { CURRENCIES, LOCALES, TIMEZONES } from "@/server/modules/companies/validation";
import { TemporaryPasswordNotice } from "../usuarios/user-forms";
import { MODULE_LABELS } from "../configuracion/forms";
import { createTenantAction, resetOwnerPasswordAction, setTenantCompanyModulesAction } from "./actions";

export function TenantCreateForm() {
  const [created, setCreated] = useState<{ id: string; slug: string; username: string; temporaryPassword: string | null } | null>(null);
  const onSuccess = useCallback((d: unknown) => setCreated(d as typeof created), []);
  if (created) {
    return (
      <Card>
        {created.temporaryPassword ? <TemporaryPasswordNotice username={created.username} password={created.temporaryPassword} /> : <Alert tone="success">Cuenta creada.</Alert>}
        <p className="mt-2 text-sm text-muted">Identificador de cuenta: <code>{created.slug}</code> (solo se pide si el usuario existe en varias cuentas).</p>
        <div className="mt-4 flex gap-2">
          <ButtonLink href={`/plataforma/${created.id}`}>Ver cuenta</ButtonLink>
          <ButtonLink variant="secondary" href="/plataforma/nueva">Crear otra</ButtonLink>
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <AppForm action={createTenantAction} successMessage={null} onSuccess={onSuccess}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField name="name" label="Nombre del negocio" required><Input name="name" /></FormField>
          <FormField name="slug" label="Identificador" required hint="Minúsculas, números y guiones. P. ej. ferreteria-lopez."><Input name="slug" autoCapitalize="none" /></FormField>
          <FormField name="companyTradeName" label="Nombre comercial de la empresa" required><Input name="companyTradeName" /></FormField>
          <FormField name="companyLegalName" label="Razón social" hint="Si se deja vacía se usa el nombre comercial."><Input name="companyLegalName" /></FormField>
          <FormField name="country" label="País (ISO)"><Input name="country" defaultValue="MX" maxLength={2} /></FormField>
          <FormField name="currency" label="Moneda"><Select name="currency" defaultValue="MXN">{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></FormField>
          <FormField name="timezone" label="Zona horaria"><Select name="timezone" defaultValue="America/Mexico_City">{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</Select></FormField>
          <FormField name="locale" label="Idioma y región"><Select name="locale" defaultValue="es-MX">{LOCALES.map((l) => <option key={l}>{l}</option>)}</Select></FormField>
        </div>
        <fieldset className="grid gap-4 rounded-app border border-border p-4 sm:grid-cols-2">
          <legend className="px-1 text-sm font-medium">Usuario dueño</legend>
          <FormField name="ownerFullName" label="Nombre completo" required><Input name="ownerFullName" /></FormField>
          <FormField name="ownerUsername" label="Usuario" required><Input name="ownerUsername" autoCapitalize="none" /></FormField>
          <FormField name="ownerEmail" label="Correo"><Input name="ownerEmail" type="email" /></FormField>
          <FormField name="ownerPassword" label="Contraseña" hint="Vacía = se genera una temporal."><Input name="ownerPassword" type="text" autoComplete="off" /></FormField>
        </fieldset>
        <div className="flex gap-2">
          <SubmitButton>Crear cuenta</SubmitButton>
          <ButtonLink variant="ghost" href="/plataforma">Cancelar</ButtonLink>
        </div>
      </AppForm>
    </Card>
  );
}

export function OwnerResetButton({ tenantId, userId, username }: { tenantId: string; userId: string; username: string }) {
  const [result, setResult] = useState<{ temporaryPassword: string } | null>(null);
  return (
    <div className="space-y-2">
      {result && <TemporaryPasswordNotice username={username} password={result.temporaryPassword} />}
      <ConfirmAction action={resetOwnerPasswordAction} label="Restablecer contraseña" variant="ghost" confirmTitle={`¿Restablecer la contraseña de @${username}?`} confirmText="Se cerrarán sus sesiones." hiddenFields={{ tenantId, userId }} onDone={(d) => setResult(d as { temporaryPassword: string })} />
    </div>
  );
}

export function TenantCompanyModulesForm({ tenantId, companyId, modules }: { tenantId: string; companyId: string; modules: Array<{ module: string; enabled: boolean }> }) {
  return (
    <AppForm action={setTenantCompanyModulesAction} successMessage="Módulos actualizados.">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="companyId" value={companyId} />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((m) => (
          <Checkbox key={m.module} name="modules[]" value={m.module} defaultChecked={m.enabled} label={MODULE_LABELS[m.module]?.label ?? m.module} />
        ))}
      </div>
      <SubmitButton variant="secondary">Guardar módulos</SubmitButton>
    </AppForm>
  );
}
