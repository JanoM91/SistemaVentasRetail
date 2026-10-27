"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, ButtonLink, Card } from "@/components/ui";
import { formatCents, formatQty, parseMoney, roundHalfEven } from "@/lib/money";
import { Field } from "../../../catalogo/product-form";
import { ExtraCostsEditor, extrasPayload, type ExtraCost } from "../../purchase-form";
import { receivePurchaseAction } from "../../actions";

type Line = { lineId: string; variantId: string; label: string; sku: string; pending: number; quantity: string; unitCost: string; taxRate: number };

export function ReceiveForm({ orderId, folio, lines: initial, currency, supplierTerms }: { orderId: string; folio: string; lines: Line[]; currency: string; supplierTerms: number }) {
  const router = useRouter();
  const [lines, setLines] = useState(initial);
  const [invoice, setInvoice] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [extras, setExtras] = useState<ExtraCost[]>([]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (id: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.lineId === id ? { ...l, ...patch } : l)));

  const active = lines.filter((l) => Number(l.quantity) > 0);
  const subtotal = active.reduce((a, l) => a + roundHalfEven(Number(l.quantity) * (parseMoney(l.unitCost) ?? 0)), 0);
  const tax = active.reduce((a, l) => a + roundHalfEven(roundHalfEven(Number(l.quantity) * (parseMoney(l.unitCost) ?? 0)) * l.taxRate), 0);
  const extra = extras.reduce((a, c) => a + (parseMoney(c.amount) ?? 0), 0);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!active.length) {
      setError("Indica cuánto llegó de al menos un producto.");
      return;
    }
    start(async () => {
      const res = await receivePurchaseAction({
        purchaseOrderId: orderId,
        supplierInvoice: invoice,
        invoiceDate,
        extraCosts: extrasPayload(extras),
        notes,
        lines: active.map((l) => ({ purchaseOrderLineId: l.lineId, variantId: l.variantId, quantity: l.quantity, unitCost: l.unitCost || "0" })),
      });
      if (res.ok) router.push(`/compras/recepciones/${res.data.id}?nuevo=1`);
      else setError(res.error);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert tone="danger" title={error} />}
      <Card title={`Lo que llegó de ${folio}`}>
        <p className="mb-3 text-sm text-muted">Se precarga lo pendiente. Corrige la cantidad si llegó menos (o 0 si no llegó). Ajusta el costo si la factura trae otro precio.</p>
        <div className="overflow-x-auto rounded-app border border-border">
          <table className="table">
            <thead>
              <tr><th>Producto</th><th className="text-right">Pendiente</th><th className="w-28">Recibido</th><th className="w-36">Costo sin IVA</th><th className="text-right">Importe</th></tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.lineId}>
                  <td><span className="block font-medium">{l.label}</span><span className="font-mono text-xs text-muted">{l.sku}</span></td>
                  <td className="text-right text-muted">{formatQty(l.pending)}</td>
                  <td><input className="field !min-h-9 !py-1" inputMode="decimal" aria-label={`Recibido de ${l.label}`} value={l.quantity} onChange={(e) => set(l.lineId, { quantity: e.target.value.replace(/[^0-9.]/g, "") })} /></td>
                  <td>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-muted">$</span>
                      <input className="field !min-h-9 !py-1 pl-5" inputMode="decimal" aria-label={`Costo de ${l.label}`} value={l.unitCost} onChange={(e) => set(l.lineId, { unitCost: e.target.value.replace(/[^0-9.,]/g, "") })} />
                    </div>
                  </td>
                  <td className="text-right">{formatCents(roundHalfEven((Number(l.quantity) || 0) * (parseMoney(l.unitCost) ?? 0)), currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Factura">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Factura del proveedor"><input className="field" value={invoice} onChange={(e) => setInvoice(e.target.value)} /></Field>
            <Field label="Fecha de la factura" hint={`Vence a ${supplierTerms} día(s).`}><input type="date" className="field" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></Field>
            <div className="sm:col-span-2"><Field label="Notas"><input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
          </div>
        </Card>
        <Card title="Costos adicionales">
          <ExtraCostsEditor value={extras} onChange={setExtras} currency={currency} />
        </Card>
      </div>
      <Card>
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div><dt className="text-muted">Mercancía</dt><dd className="font-medium">{formatCents(subtotal, currency)}</dd></div>
          <div><dt className="text-muted">IVA</dt><dd className="font-medium">{formatCents(tax, currency)}</dd></div>
          <div><dt className="text-muted">Adicionales</dt><dd className="font-medium">{formatCents(extra, currency)}</dd></div>
          <div><dt className="text-muted">Total a pagar</dt><dd className="text-lg font-semibold">{formatCents(subtotal + tax + extra, currency)}</dd></div>
        </dl>
      </Card>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Registrando…" : "Registrar recepción"}</Button>
        <ButtonLink variant="ghost" href={`/compras/${orderId}`}>Volver</ButtonLink>
      </div>
    </form>
  );
}
