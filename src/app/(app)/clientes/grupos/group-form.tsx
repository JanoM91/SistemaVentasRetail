"use client";

import { AppForm, FormField, Input, SubmitButton } from "@/components/ui/form";
import { saveGroupAction } from "../actions";

export function GroupForm({ group }: { group?: { id: string; name: string; description: string | null } }) {
  return (
    <AppForm action={saveGroupAction} successMessage={group ? "Grupo actualizado." : "Grupo creado."} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end sm:space-y-0">
      {group && <input type="hidden" name="id" value={group.id} />}
      <FormField name="name" label="Nombre" required><Input name="name" defaultValue={group?.name} placeholder="p. ej. Mayoreo" /></FormField>
      <FormField name="description" label="Descripción"><Input name="description" defaultValue={group?.description ?? ""} /></FormField>
      <SubmitButton>{group ? "Guardar" : "Crear grupo"}</SubmitButton>
    </AppForm>
  );
}
