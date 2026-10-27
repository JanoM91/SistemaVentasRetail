"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { AppForm, SubmitButton } from "@/components/ui/form";
import type { FormAction } from "@/components/ui/form";

/** Marca como revisado con una nota de lo que se hizo (queda en bitácora). */
export function ReviewForm({ id, action, label = "Marcar revisada" }: { id: string; action: FormAction; label?: string }) {
  const [open, setOpen] = useState(false);
  if (!open) return <Button type="button" variant="secondary" className="!min-h-9" onClick={() => setOpen(true)}>{label}</Button>;
  return (
    <AppForm action={action} successMessage="Listo." className="flex flex-wrap items-start gap-2 !space-y-0">
      <input type="hidden" name="id" value={id} />
      <input name="note" className="field min-w-56 flex-1" placeholder="Qué se revisó o corrigió" aria-label="Nota de revisión" autoFocus />
      <SubmitButton pendingText="…">Guardar</SubmitButton>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
    </AppForm>
  );
}
