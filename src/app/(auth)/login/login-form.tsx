"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import { AppForm, FormField, Input, SubmitButton } from "@/components/ui/form";
import { loginAction } from "./actions";

export function LoginForm({ next, tenantSlug }: { next?: string; tenantSlug?: string }) {
  const [showTenant, setShowTenant] = useState(!!tenantSlug);
  return (
    <Card>
      <AppForm action={loginAction} successMessage={null}>
        <input type="hidden" name="next" value={next ?? ""} />
        <FormField name="username" label="Usuario" required>
          <Input name="username" autoComplete="username" autoCapitalize="none" autoFocus required />
        </FormField>
        <FormField name="password" label="Contraseña" required>
          <Input name="password" type="password" autoComplete="current-password" required />
        </FormField>
        {showTenant ? (
          <FormField name="tenantSlug" label="Identificador de cuenta" hint="Solo si tu usuario existe en más de una cuenta.">
            <Input name="tenantSlug" defaultValue={tenantSlug} autoCapitalize="none" />
          </FormField>
        ) : (
          <button type="button" className="text-xs text-muted underline" onClick={() => setShowTenant(true)}>
            ¿Tu usuario existe en varias cuentas?
          </button>
        )}
        <SubmitButton className="w-full" pendingText="Entrando…">
          Entrar
        </SubmitButton>
      </AppForm>
    </Card>
  );
}
