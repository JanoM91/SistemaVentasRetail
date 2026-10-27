"use client";

import { useState } from "react";
import { Badge, Button } from "@/components/ui";
import { AppForm, Checkbox, FormField, Input, Select, SubmitButton } from "@/components/ui/form";
import { savePaymentMethodAction, saveTaxAction } from "./actions";

type Method = { id: string; code: string; name: string; kind: string; kindLabel: string; requiresReference: boolean; isActive: boolean; sortOrder: number; system: boolean };

export function PaymentMethodsEditor({ methods, kinds, canManage }: { methods: Method[]; kinds: Array<{ value: string; label: string }>; canManage: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {methods.map((m) =>
        editing === m.id ? (
          <div key={m.id} className="rounded-app border border-primary p-3">
            <AppForm action={savePaymentMethodAction} successMessage="Guardado." onSuccess={() => setTimeout(() => setEditing(null), 500)}>
              <input type="hidden" name="id" value={m.id} />
              <div className="grid gap-3 sm:grid-cols-[1fr_100px]">
                <FormField name="name" label="Nombre" required><Input name="name" defaultValue={m.name} /></FormField>
                <FormField name="sortOrder" label="Orden"><Input name="sortOrder" inputMode="numeric" defaultValue={m.sortOrder} /></FormField>
              </div>
              {m.kind !== "cash" && !m.system && <Checkbox name="requiresReference" label="Pide referencia (autorización o folio)" defaultChecked={m.requiresReference} />}
              <Checkbox name="isActive" label="Activo en caja" defaultChecked={m.isActive} />
              {m.system && <input type="hidden" name="requiresReference" value={m.requiresReference ? "on" : ""} />}
              <div className="flex gap-2"><SubmitButton>Guardar</SubmitButton><Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button></div>
            </AppForm>
          </div>
        ) : (
          <div key={m.id} className="flex items-center justify-between gap-2 rounded-app border border-border px-3 py-2 text-sm">
            <span>
              <span className="font-medium">{m.name}</span> <span className="text-muted">· {m.kindLabel}{m.requiresReference ? " · pide referencia" : ""}</span>
              {m.system && <span className="block text-xs text-muted">Del sistema: aparece solo cuando aplica.</span>}
            </span>
            <span className="flex items-center gap-2">
              {m.isActive ? <Badge tone="success">Activo</Badge> : <Badge>Inactivo</Badge>}
              {canManage && <button className="text-sm text-primary underline" onClick={() => setEditing(m.id)}>Editar</button>}
            </span>
          </div>
        ),
      )}
      {canManage &&
        (editing === "new" ? (
          <div className="rounded-app border border-primary p-3">
            <AppForm action={savePaymentMethodAction} successMessage="Método creado." onSuccess={() => setTimeout(() => setEditing(null), 500)}>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField name="name" label="Nombre" required><Input name="name" placeholder="p. ej. Mercado Pago QR" /></FormField>
                <FormField name="kind" label="Tipo" required>
                  <Select name="kind" defaultValue="qr">{kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</Select>
                </FormField>
              </div>
              <Checkbox name="requiresReference" label="Pide referencia (autorización o folio)" defaultChecked />
              <input type="hidden" name="isActive" value="on" />
              <div className="flex gap-2"><SubmitButton>Crear método</SubmitButton><Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button></div>
            </AppForm>
          </div>
        ) : (
          <Button type="button" variant="secondary" onClick={() => setEditing("new")}>Agregar método de pago</Button>
        ))}
    </div>
  );
}

type Tax = { id: string; code: string; name: string; kind: string; ratePercent: string; isIncludedInPrice: boolean; isDefault: boolean; products: number };

export function TaxesEditor({ taxes, canManage }: { taxes: Tax[]; canManage: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const form = (t?: Tax) => (
    <AppForm action={saveTaxAction} successMessage={t ? `Guardado. Afecta a ${t.products} producto(s); el POS toma la tasa nueva al actualizar su catálogo.` : "Impuesto creado."} onSuccess={() => setTimeout(() => setEditing(null), 1500)}>
      {t && <input type="hidden" name="id" value={t.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        {!t && <FormField name="code" label="Clave" required><Input name="code" className="font-mono uppercase" placeholder="IEPS8" /></FormField>}
        <FormField name="name" label="Nombre" required><Input name="name" defaultValue={t?.name} /></FormField>
        <FormField name="kind" label="Tipo">
          <Select name="kind" defaultValue={t?.kind ?? "iva"}><option value="iva">IVA</option><option value="ieps">IEPS</option><option value="otro">Otro</option></Select>
        </FormField>
        <FormField name="ratePercent" label="Tasa (%)" required><Input name="ratePercent" inputMode="decimal" defaultValue={t?.ratePercent ?? ""} /></FormField>
      </div>
      <Checkbox name="isIncludedInPrice" label="El precio de venta ya lo incluye" hint="Lo normal en tiendas: el precio en anaquel es el final." defaultChecked={t?.isIncludedInPrice ?? true} />
      <Checkbox name="isDefault" label="Usar por defecto en productos nuevos" defaultChecked={t?.isDefault ?? false} />
      {t && t.products > 0 && <p className="text-xs text-warning">Cambiar la tasa afecta el impuesto de {t.products} producto(s) en las ventas nuevas. Las ventas ya registradas no cambian.</p>}
      <div className="flex gap-2"><SubmitButton>{t ? "Guardar" : "Crear impuesto"}</SubmitButton><Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button></div>
    </AppForm>
  );
  return (
    <div className="space-y-2">
      {taxes.map((t) =>
        editing === t.id ? (
          <div key={t.id} className="rounded-app border border-primary p-3">{form(t)}</div>
        ) : (
          <div key={t.id} className="flex items-center justify-between gap-2 rounded-app border border-border px-3 py-2 text-sm">
            <span>
              <span className="font-mono text-xs">{t.code}</span> <span className="font-medium">{t.name}</span> · {t.ratePercent} % · {t.isIncludedInPrice ? "incluido" : "más impuesto"} {t.isDefault && <Badge tone="info">Por defecto</Badge>}
              <span className="block text-xs text-muted">{t.products} producto(s)</span>
            </span>
            {canManage && <button className="text-sm text-primary underline" onClick={() => setEditing(t.id)}>Editar</button>}
          </div>
        ),
      )}
      {canManage && (editing === "new" ? <div className="rounded-app border border-primary p-3">{form()}</div> : <Button type="button" variant="secondary" onClick={() => setEditing("new")}>Agregar impuesto</Button>)}
    </div>
  );
}
