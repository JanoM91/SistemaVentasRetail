"use client";

import { useState } from "react";
import { AppForm, FormField, Input, SubmitButton } from "@/components/ui/form";
import { createCouponsAction } from "../actions";

export function CouponForm({ promotionId }: { promotionId: string }) {
  const [mode, setMode] = useState<"single" | "batch">("single");
  return (
    <AppForm action={createCouponsAction} successMessage="Cupones creados.">
      <input type="hidden" name="promotionId" value={promotionId} />
      <input type="hidden" name="mode" value={mode} />
      <div className="flex gap-2">
        <button type="button" onClick={() => setMode("single")} className={`rounded-app border px-3 py-2 text-sm ${mode === "single" ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>Un código para todos</button>
        <button type="button" onClick={() => setMode("batch")} className={`rounded-app border px-3 py-2 text-sm ${mode === "batch" ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>Lote de códigos únicos</button>
      </div>
      {mode === "single" ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField name="code" label="Código" required hint="p. ej. BIENVENIDA10"><Input name="code" className="font-mono uppercase" /></FormField>
          <FormField name="maxUses" label="Usos máximos" hint="Vacío = ilimitado."><Input name="maxUses" inputMode="numeric" /></FormField>
          <FormField name="expiresAt" label="Vence"><Input name="expiresAt" type="date" /></FormField>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField name="prefix" label="Prefijo" hint="p. ej. VIP"><Input name="prefix" className="font-mono uppercase" /></FormField>
          <FormField name="count" label="Cantidad" required hint="Cada código es de un solo uso."><Input name="count" inputMode="numeric" defaultValue="20" /></FormField>
          <FormField name="expiresAt" label="Vence"><Input name="expiresAt" type="date" /></FormField>
        </div>
      )}
      <SubmitButton pendingText="Creando…">Crear cupones</SubmitButton>
    </AppForm>
  );
}
