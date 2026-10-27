"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { AppForm, FormField, Input, Select, SubmitButton } from "@/components/ui/form";
import { payPayableAction } from "../actions";

/** Registrar un pago (total o parcial) a una cuenta por pagar. */
export function PayDialog({ payableId, balance, label, autoOpen = false }: { payableId: string; balance: number; label: string; autoOpen?: boolean }) {
  const [open, setOpen] = useState(autoOpen);
  return (
    <>
      <Button type="button" variant="secondary" className="!min-h-9" onClick={() => setOpen(true)}>Pagar</Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby={`pay-${payableId}`}>
          <div className="w-full max-w-md rounded-app border border-border bg-surface p-5 shadow-xl">
            <h2 id={`pay-${payableId}`} className="mb-1 text-lg font-semibold">Registrar pago</h2>
            <p className="mb-4 text-sm text-muted">{label}</p>
            <AppForm action={payPayableAction} successMessage="Pago registrado." onSuccess={() => setTimeout(() => setOpen(false), 600)}>
              <input type="hidden" name="payableId" value={payableId} />
              <FormField name="amount" label="Importe" required hint={`Saldo: ${(balance / 100).toFixed(2)}`}>
                <Input name="amount" inputMode="decimal" defaultValue={(balance / 100).toFixed(2)} autoFocus />
              </FormField>
              <FormField name="method" label="Método" required>
                <Select name="method" defaultValue="Transferencia">
                  <option>Transferencia</option>
                  <option>Efectivo</option>
                  <option>Cheque</option>
                  <option>Tarjeta</option>
                </Select>
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField name="reference" label="Referencia"><Input name="reference" placeholder="Folio o rastreo" /></FormField>
                <FormField name="paidAt" label="Fecha"><Input name="paidAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></FormField>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cerrar</Button>
                <SubmitButton pendingText="Registrando…">Registrar pago</SubmitButton>
              </div>
            </AppForm>
          </div>
        </div>
      )}
    </>
  );
}
