"use client";

import { useState } from "react";
import { AppForm, Checkbox, FormField, Input, Select, SubmitButton } from "@/components/ui/form";
import { creditAdjustmentAction, creditTermsAction, customerPaymentAction } from "../actions";

export function CreditTermsForm({ customerId, limit, days, blocked }: { customerId: string; limit: number | null; days: number; blocked: boolean }) {
  const [enabled, setEnabled] = useState(limit !== null);
  return (
    <AppForm action={creditTermsAction} successMessage="Condiciones de crédito guardadas.">
      <input type="hidden" name="id" value={customerId} />
      <Checkbox name="enabled" label="Puede comprar a crédito" checked={enabled} onChange={(e) => setEnabled(e.currentTarget.checked)} />
      {enabled && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField name="creditLimit" label="Límite de crédito" required><Input name="creditLimit" inputMode="decimal" defaultValue={limit !== null ? (limit / 100).toFixed(2) : ""} placeholder="0.00" /></FormField>
          <FormField name="creditDays" label="Días para pagar"><Input name="creditDays" inputMode="numeric" defaultValue={days} /></FormField>
          <div className="sm:col-span-2"><Checkbox name="creditBlocked" label="Bloquear crédito" hint="No podrá comprar a crédito hasta desbloquearlo; sí puede abonar." defaultChecked={blocked} /></div>
        </div>
      )}
      <SubmitButton>Guardar condiciones</SubmitButton>
    </AppForm>
  );
}

export function BackofficePaymentForm({ customerId, balance, methods }: { customerId: string; balance: number; methods: Array<{ id: string; name: string; requiresReference: boolean }> }) {
  return (
    <AppForm action={customerPaymentAction} successMessage="Abono registrado.">
      <input type="hidden" name="customerId" value={customerId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="amount" label="Importe" required hint={`Saldo ${(balance / 100).toFixed(2)}`}><Input name="amount" inputMode="decimal" placeholder="0.00" /></FormField>
        <FormField name="paymentMethodId" label="Método" required>
          <Select name="paymentMethodId" defaultValue={methods[0]?.id}>{methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
        </FormField>
        <FormField name="reference" label="Referencia" hint="Folio de transferencia o autorización."><Input name="reference" /></FormField>
        <FormField name="notes" label="Notas"><Input name="notes" /></FormField>
      </div>
      <p className="text-xs text-muted">Los abonos en efectivo se cobran en el punto de venta (botón «Abono») para que entren al corte de caja.</p>
      <SubmitButton pendingText="Registrando…">Registrar abono</SubmitButton>
    </AppForm>
  );
}

export function AdjustmentForm({ customerId }: { customerId: string }) {
  return (
    <AppForm action={creditAdjustmentAction} successMessage="Ajuste registrado.">
      <input type="hidden" name="customerId" value={customerId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="direction" label="Tipo">
          <Select name="direction" defaultValue="credit">
            <option value="credit">A favor del cliente (reduce el saldo)</option>
            <option value="charge">A cargo del cliente (saldo inicial, corrección)</option>
          </Select>
        </FormField>
        <FormField name="amount" label="Importe" required><Input name="amount" inputMode="decimal" placeholder="0.00" /></FormField>
        <div className="sm:col-span-2"><FormField name="reason" label="Motivo" required><Input name="reason" placeholder="p. ej. Saldo inicial migrado de la libreta" /></FormField></div>
      </div>
      <SubmitButton variant="secondary" pendingText="Registrando…">Registrar ajuste</SubmitButton>
    </AppForm>
  );
}
