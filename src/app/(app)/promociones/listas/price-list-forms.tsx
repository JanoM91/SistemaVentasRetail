"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Alert, Button } from "@/components/ui";
import { AppForm, Checkbox, FormField, Input, SubmitButton } from "@/components/ui/form";
import { VariantPicker } from "@/components/variant-picker";
import { formatCents, parseMoney } from "@/lib/money";
import { savePriceItemsAction, savePriceListAction } from "../actions";

export function PriceListForm({ list }: { list?: { id: string; name: string; adjustmentPercent: string | null; isActive: boolean } }) {
  const router = useRouter();
  const onSuccess = useCallback((d: unknown) => { if (!list) router.push(`/promociones/listas/${(d as { id: string }).id}`); }, [router, list]);
  return (
    <AppForm action={savePriceListAction} onSuccess={onSuccess} successMessage={list ? "Lista guardada." : null}>
      {list && <input type="hidden" name="id" value={list.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="name" label="Nombre" required><Input name="name" defaultValue={list?.name} placeholder="p. ej. Mayoreo" /></FormField>
        <FormField name="adjustmentPercent" label="Ajuste para productos sin precio fijo (%)" hint="−10 = 10 % menos que el precio normal. Vacío = precio normal.">
          <Input name="adjustmentPercent" inputMode="decimal" defaultValue={list?.adjustmentPercent ? String(Number(list.adjustmentPercent)) : ""} />
        </FormField>
      </div>
      {list && <Checkbox name="isActive" label="Activa" defaultChecked={list.isActive} />}
      <SubmitButton>{list ? "Guardar" : "Crear lista"}</SubmitButton>
    </AppForm>
  );
}

type Row = { variantId: string; label: string; sku: string; basePrice: number; price: string };

export function PriceItemsEditor({ listId, initial, currency }: { listId: string; initial: Row[]; currency: string }) {
  const [rows, setRows] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <VariantPicker value={null} currency={currency} onChange={(v) => v && !rows.some((r) => r.variantId === v.id) && setRows([...rows, { variantId: v.id, label: `${v.name}${v.variantName ? ` · ${v.variantName}` : ""}`, sku: v.sku, basePrice: v.price, price: (v.price / 100).toFixed(2) }])} />
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-app border border-border">
          <table className="table">
            <thead><tr><th>Producto</th><th className="text-right">Precio normal</th><th className="w-36">Precio en lista</th><th className="text-right">Diferencia</th><th /></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const p = parseMoney(r.price);
                return (
                  <tr key={r.variantId}>
                    <td>{r.label}<span className="block font-mono text-xs text-muted">{r.sku}</span></td>
                    <td className="text-right text-muted">{formatCents(r.basePrice, currency)}</td>
                    <td><input className="field !min-h-9 !py-1" inputMode="decimal" aria-label={`Precio en lista de ${r.label}`} value={r.price} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} /></td>
                    <td className="text-right">{p !== null && r.basePrice ? `${Math.round(((p - r.basePrice) / r.basePrice) * 1000) / 10} %` : "—"}</td>
                    <td><button type="button" className="p-1 text-danger" aria-label={`Quitar ${r.label}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {msg && <Alert tone={msg.ok ? "success" : "danger"} title={msg.text} />}
      <Button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await savePriceItemsAction(listId, rows.map((x) => ({ variantId: x.variantId, price: x.price })));
            setMsg(r.ok ? { ok: true, text: `Se guardaron ${r.data} precio(s).` } : { ok: false, text: r.error });
          })
        }
      >
        {pending ? "Guardando…" : "Guardar precios"}
      </Button>
    </div>
  );
}
