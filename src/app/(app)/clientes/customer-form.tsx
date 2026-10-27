"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { ButtonLink } from "@/components/ui";
import { AppForm, Checkbox, FormField, Input, Select, SubmitButton } from "@/components/ui/form";
import { createCustomerAction, updateCustomerAction } from "./actions";

/** Regímenes fiscales del SAT más comunes en clientes de comercio. */
export const TAX_REGIMES = [
  ["601", "General de Ley Personas Morales"],
  ["603", "Personas Morales con Fines no Lucrativos"],
  ["605", "Sueldos y Salarios"],
  ["606", "Arrendamiento"],
  ["612", "Personas Físicas con Actividades Empresariales y Profesionales"],
  ["616", "Sin obligaciones fiscales"],
  ["621", "Incorporación Fiscal"],
  ["626", "Régimen Simplificado de Confianza"],
] as const;
export const CFDI_USES = [
  ["G01", "Adquisición de mercancías"],
  ["G03", "Gastos en general"],
  ["S01", "Sin efectos fiscales"],
] as const;

type Customer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  groupId: string | null;
  taxId: string | null;
  legalName: string | null;
  taxRegime: string | null;
  cfdiUse: string | null;
  taxPostalCode: string | null;
  address: Record<string, string | undefined>;
  notes: string | null;
  marketingConsent: boolean;
};

export function CustomerForm({ customer, groups, readOnly }: { customer?: Customer; groups: Array<{ id: string; name: string }>; readOnly?: boolean }) {
  const router = useRouter();
  const onSuccess = useCallback((d: unknown) => {
    if (!customer) router.push(`/clientes/${(d as { id: string }).id}`);
  }, [router, customer]);
  const a = customer?.address ?? {};
  return (
    <AppForm action={customer ? updateCustomerAction : createCustomerAction} onSuccess={onSuccess} successMessage={customer ? "Cliente actualizado." : null}>
      {customer && <input type="hidden" name="id" value={customer.id} />}
      <fieldset disabled={readOnly} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><FormField name="name" label="Nombre" required><Input name="name" defaultValue={customer?.name} autoFocus={!customer} /></FormField></div>
          <FormField name="phone" label="Teléfono" hint="10 dígitos; sirve para buscarlo en caja."><Input name="phone" inputMode="tel" defaultValue={customer?.phone ?? ""} /></FormField>
          <FormField name="email" label="Correo"><Input name="email" type="email" defaultValue={customer?.email ?? ""} /></FormField>
          <FormField name="birthday" label="Cumpleaños"><Input name="birthday" type="date" defaultValue={customer?.birthday ?? ""} /></FormField>
          <FormField name="groupId" label="Grupo">
            <Select name="groupId" defaultValue={customer?.groupId ?? ""}>
              <option value="">Sin grupo</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
          </FormField>
          <div className="sm:col-span-2">
            <Checkbox name="marketingConsent" label="Acepta recibir promociones" hint="Consentimiento para contactarlo por WhatsApp, SMS o correo. Se guarda la fecha." defaultChecked={customer?.marketingConsent} />
          </div>
        </div>
        <details className="rounded-app border border-border p-3" open={!!customer?.taxId}>
          <summary className="cursor-pointer text-sm font-medium">Datos para factura</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <FormField name="taxId" label="RFC"><Input name="taxId" className="uppercase" defaultValue={customer?.taxId ?? ""} /></FormField>
            <FormField name="legalName" label="Razón social" hint="Tal como aparece en su constancia."><Input name="legalName" defaultValue={customer?.legalName ?? ""} /></FormField>
            <FormField name="taxRegime" label="Régimen fiscal">
              <Select name="taxRegime" defaultValue={customer?.taxRegime ?? ""}>
                <option value="">—</option>
                {TAX_REGIMES.map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
              </Select>
            </FormField>
            <FormField name="cfdiUse" label="Uso del CFDI">
              <Select name="cfdiUse" defaultValue={customer?.cfdiUse ?? ""}>
                <option value="">—</option>
                {CFDI_USES.map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
              </Select>
            </FormField>
            <FormField name="taxPostalCode" label="C.P. fiscal"><Input name="taxPostalCode" inputMode="numeric" defaultValue={customer?.taxPostalCode ?? ""} /></FormField>
          </div>
        </details>
        <details className="rounded-app border border-border p-3" open={!!a.street}>
          <summary className="cursor-pointer text-sm font-medium">Dirección de entrega</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><FormField name="address.street" label="Calle y número"><Input name="address.street" defaultValue={a.street ?? ""} /></FormField></div>
            <FormField name="address.neighborhood" label="Colonia"><Input name="address.neighborhood" defaultValue={a.neighborhood ?? ""} /></FormField>
            <FormField name="address.city" label="Ciudad"><Input name="address.city" defaultValue={a.city ?? ""} /></FormField>
            <FormField name="address.references" label="Referencias"><Input name="address.references" defaultValue={a.references ?? ""} /></FormField>
          </div>
        </details>
        <FormField name="notes" label="Notas"><Input name="notes" defaultValue={customer?.notes ?? ""} /></FormField>
        {!customer && <Checkbox name="allowDuplicate" value="1" label="Es otra persona aunque comparta teléfono o correo con un cliente existente" />}
      </fieldset>
      {!readOnly && (
        <div className="flex gap-2">
          <SubmitButton>{customer ? "Guardar cambios" : "Crear cliente"}</SubmitButton>
          <ButtonLink variant="ghost" href="/clientes">Volver</ButtonLink>
        </div>
      )}
    </AppForm>
  );
}
