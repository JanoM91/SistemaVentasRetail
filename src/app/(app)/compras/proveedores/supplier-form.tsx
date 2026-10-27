"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { ButtonLink } from "@/components/ui";
import { AppForm, FormField, Input, SubmitButton } from "@/components/ui/form";
import { createSupplierAction, updateSupplierAction } from "../actions";

type Supplier = {
  id: string;
  code: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: Record<string, string | undefined> | null;
  paymentTermsDays: number;
  leadTimeDays: number;
  notes: string | null;
};

export function SupplierForm({ supplier }: { supplier?: Supplier }) {
  const router = useRouter();
  const onSuccess = useCallback((data: unknown) => {
    if (!supplier) router.push(`/compras/proveedores/${(data as { id: string }).id}`);
  }, [router, supplier]);
  const a = supplier?.address ?? {};
  return (
    <AppForm action={supplier ? updateSupplierAction : createSupplierAction} onSuccess={onSuccess} successMessage={supplier ? "Proveedor actualizado." : null}>
      {supplier && <input type="hidden" name="id" value={supplier.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="code" label="Clave" required hint={supplier ? "No se puede cambiar." : "Corta y única, p. ej. COCA o DIST-01."}>
          <Input name="code" defaultValue={supplier?.code} disabled={!!supplier} autoFocus={!supplier} />
        </FormField>
        <FormField name="name" label="Nombre comercial" required><Input name="name" defaultValue={supplier?.name} /></FormField>
        <FormField name="legalName" label="Razón social"><Input name="legalName" defaultValue={supplier?.legalName ?? ""} /></FormField>
        <FormField name="taxId" label="RFC"><Input name="taxId" defaultValue={supplier?.taxId ?? ""} className="uppercase" /></FormField>
        <FormField name="contactName" label="Contacto"><Input name="contactName" defaultValue={supplier?.contactName ?? ""} /></FormField>
        <FormField name="phone" label="Teléfono"><Input name="phone" inputMode="tel" defaultValue={supplier?.phone ?? ""} /></FormField>
        <FormField name="email" label="Correo"><Input name="email" type="email" defaultValue={supplier?.email ?? ""} /></FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField name="paymentTermsDays" label="Días de crédito" hint="0 = contado."><Input name="paymentTermsDays" inputMode="numeric" defaultValue={supplier?.paymentTermsDays ?? 0} /></FormField>
          <FormField name="leadTimeDays" label="Días de entrega" hint="Para sugerencias."><Input name="leadTimeDays" inputMode="numeric" defaultValue={supplier?.leadTimeDays ?? 7} /></FormField>
        </div>
        <FormField name="address.street" label="Calle y número"><Input name="address.street" defaultValue={a.street ?? ""} /></FormField>
        <div className="grid grid-cols-3 gap-4">
          <FormField name="address.city" label="Ciudad"><Input name="address.city" defaultValue={a.city ?? ""} /></FormField>
          <FormField name="address.state" label="Estado"><Input name="address.state" defaultValue={a.state ?? ""} /></FormField>
          <FormField name="address.postalCode" label="C.P."><Input name="address.postalCode" inputMode="numeric" defaultValue={a.postalCode ?? ""} /></FormField>
        </div>
        <div className="sm:col-span-2"><FormField name="notes" label="Notas"><Input name="notes" defaultValue={supplier?.notes ?? ""} /></FormField></div>
      </div>
      <div className="flex gap-2">
        <SubmitButton>{supplier ? "Guardar cambios" : "Crear proveedor"}</SubmitButton>
        <ButtonLink variant="ghost" href="/compras/proveedores">Volver</ButtonLink>
      </div>
    </AppForm>
  );
}
