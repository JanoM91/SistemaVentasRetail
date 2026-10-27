"use client";

import { AppForm, FormField, Input, Select, SubmitButton } from "@/components/ui/form";
import { saveGroupAction } from "../actions";

export function GroupForm({ group, priceLists = [] }: { group?: { id: string; name: string; description: string | null; priceListId?: string | null }; priceLists?: Array<{ id: string; name: string }> }) {
  return (
    <AppForm action={saveGroupAction} successMessage={group ? "Grupo actualizado." : "Grupo creado."} className="grid gap-3 sm:grid-cols-[1fr_1.5fr_1fr_auto] sm:items-end sm:space-y-0">
      {group && <input type="hidden" name="id" value={group.id} />}
      <FormField name="name" label="Nombre" required><Input name="name" defaultValue={group?.name} placeholder="p. ej. Mayoreo" /></FormField>
      <FormField name="description" label="Descripción"><Input name="description" defaultValue={group?.description ?? ""} /></FormField>
      <FormField name="priceListId" label="Lista de precios">
        <Select name="priceListId" defaultValue={group?.priceListId ?? ""}>
          <option value="">Precio normal</option>
          {priceLists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      </FormField>
      <SubmitButton>{group ? "Guardar" : "Crear grupo"}</SubmitButton>
    </AppForm>
  );
}
