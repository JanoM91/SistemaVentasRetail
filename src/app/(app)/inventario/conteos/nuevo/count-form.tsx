"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { ButtonLink } from "@/components/ui";
import { AppForm, FormField, Input, Select, SubmitButton } from "@/components/ui/form";
import { createCountAction } from "../../actions";

export function CountForm({ warehouses, categories, defaultWarehouseId }: { warehouses: Array<{ id: string; label: string }>; categories: Array<{ id: string; name: string }>; defaultWarehouseId: string }) {
  const router = useRouter();
  const onSuccess = useCallback((d: unknown) => router.push(`/inventario/conteos/${(d as { id: string }).id}`), [router]);
  return (
    <AppForm action={createCountAction} onSuccess={onSuccess} successMessage={null}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="warehouseId" label="Almacén" required>
          <Select name="warehouseId" defaultValue={defaultWarehouseId}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</Select>
        </FormField>
        <FormField name="categoryId" label="Alcance" hint="Contar todo o solo una categoría (conteo cíclico).">
          <Select name="categoryId" defaultValue=""><option value="">Todo el almacén</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        </FormField>
        <div className="sm:col-span-2"><FormField name="notes" label="Notas"><Input name="notes" placeholder="p. ej. Conteo de cierre de mes" /></FormField></div>
      </div>
      <div className="flex gap-2">
        <SubmitButton pendingText="Creando…">Iniciar conteo</SubmitButton>
        <ButtonLink variant="ghost" href="/inventario/conteos">Cancelar</ButtonLink>
      </div>
    </AppForm>
  );
}
