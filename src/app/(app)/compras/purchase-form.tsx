"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Button, ButtonLink, Card } from "@/components/ui";
import { LinesEditor, newLineKey, type DocLine } from "@/components/lines-editor";
import { formatCents, parseMoney } from "@/lib/money";
import { Field, MoneyInput } from "../catalogo/product-form";
import { costHintsAction, receivePurchaseAction, savePurchaseOrderAction } from "./actions";

export type SupplierOption = { id: string; name: string; paymentTermsDays: number };
export type WarehouseOption = { id: string; label: string };
export type ExtraCost = { key: string; concept: string; amount: string };

const today = () => new Date().toISOString().slice(0, 10);

/** Costos adicionales (flete, maniobras, seguro) que se prorratean al costo de la mercancía. */
export function ExtraCostsEditor({ value, onChange, currency }: { value: ExtraCost[]; onChange: (v: ExtraCost[]) => void; currency: string }) {
  const total = value.reduce((a, c) => a + (parseMoney(c.amount) ?? 0), 0);
  return (
    <div className="space-y-2">
      {value.map((c) => (
        <div key={c.key} className="flex items-center gap-2">
          <input className="field flex-1" placeholder="Concepto (p. ej. Flete)" aria-label="Concepto" value={c.concept} onChange={(e) => onChange(value.map((x) => (x.key === c.key ? { ...x, concept: e.target.value } : x)))} />
          <div className="w-36"><MoneyInput value={c.amount} onChange={(v) => onChange(value.map((x) => (x.key === c.key ? { ...x, amount: v } : x)))} /></div>
          <button type="button" className="rounded p-2 text-muted hover:text-danger" aria-label="Quitar costo" onClick={() => onChange(value.filter((x) => x.key !== c.key))}><Trash2 className="size-4" /></button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <button type="button" className="inline-flex items-center gap-1 text-sm text-primary" onClick={() => onChange([...value, { key: newLineKey(), concept: value.length ? "" : "Flete", amount: "" }])}>
          <Plus className="size-4" /> Agregar costo adicional
        </button>
        {total > 0 && <span className="text-sm text-muted">Total adicional: {formatCents(total, currency)} · se reparte según el valor de cada producto</span>}
      </div>
    </div>
  );
}

export const extrasPayload = (x: ExtraCost[]) => x.filter((c) => c.concept.trim() || c.amount).map((c) => ({ concept: c.concept.trim(), amount: c.amount || "0" }));

/** Alta/edición de orden de compra, o compra directa (recibe sin orden). */
export function PurchaseForm({
  mode,
  orderId,
  suppliers,
  warehouses,
  currency,
  initial,
}: {
  mode: "order" | "direct";
  orderId?: string;
  suppliers: SupplierOption[];
  warehouses: WarehouseOption[];
  currency: string;
  initial?: { supplierId: string; warehouseId: string; expectedAt: string; notes: string; lines: DocLine[] };
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? "");
  const [warehouseId, setWarehouseId] = useState(initial?.warehouseId ?? warehouses[0]?.id ?? "");
  const [expectedAt, setExpectedAt] = useState(initial?.expectedAt ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [lines, setLines] = useState<DocLine[]>(initial?.lines ?? []);
  const [invoice, setInvoice] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [terms, setTerms] = useState<string>("");
  const [extras, setExtras] = useState<ExtraCost[]>([]);
  const [error, setError] = useState<{ text: string; fields?: Record<string, string[]> } | null>(null);
  const [pending, start] = useTransition();
  const supplier = suppliers.find((s) => s.id === supplierId);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payloadLines = lines.map((l) => ({ variantId: l.variant.id, quantity: l.quantity, unitCost: l.unitCost || "0" }));
    start(async () => {
      if (mode === "order") {
        const res = await savePurchaseOrderAction(orderId ?? null, { supplierId, warehouseId, expectedAt, notes, lines: payloadLines });
        if (res.ok) router.push(`/compras/${res.data.id}`);
        else setError({ text: res.error, fields: res.fieldErrors });
      } else {
        const res = await receivePurchaseAction({
          supplierId,
          warehouseId,
          supplierInvoice: invoice,
          invoiceDate,
          paymentTermsDays: terms === "" ? undefined : terms,
          extraCosts: extrasPayload(extras),
          notes,
          lines: payloadLines,
        });
        if (res.ok) router.push(`/compras/recepciones/${res.data.id}?nuevo=1`);
        else setError({ text: res.error, fields: res.fieldErrors });
      }
    });
  }
  const err = (k: string) => error?.fields?.[k]?.join(" ");

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert tone="danger" title={error.text}>{error.fields?.lines?.join(" ")}</Alert>}
      <Card title="Datos generales">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Proveedor" required error={err("supplierId")}>
            <select className="field" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Elige un proveedor</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label={mode === "order" ? "Almacén de destino" : "Almacén donde entra"} required error={err("warehouseId")}>
            <select className="field" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
            </select>
          </Field>
          {mode === "order" ? (
            <Field label="Fecha esperada de entrega" hint="Opcional.">
              <input type="date" className="field" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
            </Field>
          ) : (
            <>
              <Field label="Factura del proveedor" hint="Folio o número de remisión.">
                <input className="field" value={invoice} onChange={(e) => setInvoice(e.target.value)} />
              </Field>
              <Field label="Fecha de la factura" error={err("invoiceDate")}>
                <input type="date" className="field" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </Field>
              <Field label="Días de crédito" hint={supplier ? `Si lo dejas vacío se usan los del proveedor (${supplier.paymentTermsDays}).` : "Si lo dejas vacío se usan los del proveedor."}>
                <input className="field" inputMode="numeric" value={terms} onChange={(e) => setTerms(e.target.value.replace(/\D/g, ""))} />
              </Field>
            </>
          )}
          <div className="sm:col-span-2">
            <Field label="Notas">
              <input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
        </div>
      </Card>
      <Card title="Productos">
        <LinesEditor
          lines={lines}
          onChange={setLines}
          withCost
          currency={currency}
          costHint={async (vid) => {
            const r = await costHintsAction(supplierId || null, [vid]);
            return r.ok ? (r.data[vid] ?? null) : null;
          }}
        />
        <p className="mt-2 text-xs text-muted">Los costos se capturan sin IVA; el IVA se calcula con la tasa de cada producto.</p>
      </Card>
      {mode === "direct" && (
        <Card title="Costos adicionales">
          <ExtraCostsEditor value={extras} onChange={setExtras} currency={currency} />
        </Card>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : mode === "direct" ? "Registrar compra y dar entrada" : orderId ? "Guardar cambios" : "Guardar borrador"}
        </Button>
        <ButtonLink variant="ghost" href={orderId ? `/compras/${orderId}` : "/compras"}>Cancelar</ButtonLink>
      </div>
    </form>
  );
}
