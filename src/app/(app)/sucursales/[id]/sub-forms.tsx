"use client";

import { AppForm, Checkbox, FormField, Input, SubmitButton } from "@/components/ui/form";
import { createCashRegisterAction, createWarehouseAction, updateWarehouseAction } from "../actions";

export function NewWarehouseForm({ branchId }: { branchId: string }) {
  return (
    <details className="rounded-app border border-dashed border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">Agregar almacén</summary>
      <div className="mt-3">
        <AppForm action={createWarehouseAction} successMessage="Almacén creado.">
          <input type="hidden" name="branchId" value={branchId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField name="code" label="Código" required><Input name="code" autoCapitalize="characters" /></FormField>
            <FormField name="name" label="Nombre" required><Input name="name" /></FormField>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Checkbox name="isDefault" label="Almacén principal" hint="Las ventas descuentan de aquí por defecto." />
            <Checkbox name="allowsNegativeStock" label="Permitir inventario negativo" hint="Solo si vendes sin registrar entradas a tiempo." />
          </div>
          <SubmitButton variant="secondary">Crear almacén</SubmitButton>
        </AppForm>
      </div>
    </details>
  );
}

export function WarehouseRowForm({ warehouse }: { warehouse: { id: string; branchId: string; name: string; isDefault: boolean; allowsNegativeStock: boolean } }) {
  return (
    <td colSpan={4} className="!p-1">
      <AppForm action={updateWarehouseAction} successMessage="Almacén actualizado." className="flex flex-wrap items-center gap-2 !space-y-0">
        <input type="hidden" name="id" value={warehouse.id} />
        <input type="hidden" name="branchId" value={warehouse.branchId} />
        <input name="name" defaultValue={warehouse.name} className="field !min-h-9 max-w-56 !py-1 text-sm" aria-label="Nombre del almacén" />
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="isDefault" defaultChecked={warehouse.isDefault} className="accent-primary" /> Principal</label>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="allowsNegativeStock" defaultChecked={warehouse.allowsNegativeStock} className="accent-primary" /> Negativo</label>
        <SubmitButton variant="ghost" className="!min-h-9 !px-3 text-xs">Guardar</SubmitButton>
      </AppForm>
    </td>
  );
}

export function NewCashRegisterForm({ branchId }: { branchId: string }) {
  return (
    <details className="rounded-app border border-dashed border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">Agregar caja</summary>
      <div className="mt-3">
        <AppForm action={createCashRegisterAction} successMessage="Caja creada.">
          <input type="hidden" name="branchId" value={branchId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField name="code" label="Código" required><Input name="code" autoCapitalize="characters" /></FormField>
            <FormField name="name" label="Nombre" required><Input name="name" /></FormField>
          </div>
          <SubmitButton variant="secondary">Crear caja</SubmitButton>
        </AppForm>
      </div>
    </details>
  );
}
