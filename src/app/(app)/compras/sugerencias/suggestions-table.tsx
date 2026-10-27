"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Alert, Button } from "@/components/ui";
import type { PurchaseSuggestion } from "@/server/modules/purchasing/service";
import { formatQty } from "@/lib/money";
import { createOrdersFromSuggestionsAction } from "../actions";

type Row = PurchaseSuggestion & { selected: boolean; qty: string; cost: string; sup: string };

export function SuggestionsTable({ warehouseId, items, suppliers }: { warehouseId: string; items: PurchaseSuggestion[]; suppliers: Array<{ id: string; name: string }> }) {
  const [rows, setRows] = useState<Row[]>(() => items.map((s) => ({ ...s, selected: !!s.supplierId, qty: String(s.suggested), cost: s.lastCost !== null ? (s.lastCost / 100).toFixed(2) : "", sup: s.supplierId ?? "" })));
  const [result, setResult] = useState<{ ok: boolean; text: string; orders?: Array<{ id: string; folio: string }> } | null>(null);
  const [pending, start] = useTransition();
  const set = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.variantId === id ? { ...r, ...patch } : r)));
  const selected = rows.filter((r) => r.selected && Number(r.qty) > 0);

  function create() {
    setResult(null);
    start(async () => {
      const res = await createOrdersFromSuggestionsAction(warehouseId, selected.map((r) => ({ variantId: r.variantId, quantity: Number(r.qty), supplierId: r.sup, unitCost: r.cost || "0" })));
      if (res.ok) {
        setResult({ ok: true, text: `Se crearon ${res.data.length} orden(es) en borrador. Revísalas y envíalas al proveedor.`, orders: res.data });
        setRows((rs) => rs.filter((r) => !r.selected));
      } else setResult({ ok: false, text: res.error });
    });
  }

  return (
    <div className="space-y-4">
      {result && (
        <Alert tone={result.ok ? "success" : "danger"} title={result.text}>
          {result.orders && <span className="flex flex-wrap gap-3">{result.orders.map((o) => <Link key={o.id} className="link font-mono" href={`/compras/${o.id}`}>{o.folio}</Link>)}</span>}
        </Alert>
      )}
      <div className="overflow-x-auto rounded-app border border-border bg-surface">
        <table className="table">
          <thead>
            <tr>
              <th className="w-10"><input type="checkbox" aria-label="Seleccionar todo" className="accent-primary" checked={rows.length > 0 && rows.every((r) => r.selected)} onChange={(e) => setRows((rs) => rs.map((r) => ({ ...r, selected: e.target.checked })))} /></th>
              <th>Producto</th>
              <th className="text-right">Existencia</th>
              <th className="hidden text-right md:table-cell">Pedido</th>
              <th className="hidden text-right md:table-cell" title="Venta de los últimos 30 días">Venta 30 d</th>
              <th className="hidden text-right lg:table-cell">Reorden</th>
              <th className="w-24">Pedir</th>
              <th className="w-48">Proveedor</th>
              <th className="w-28">Costo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.variantId}>
                <td><input type="checkbox" aria-label={`Seleccionar ${r.name}`} className="accent-primary" checked={r.selected} onChange={(e) => set(r.variantId, { selected: e.target.checked })} /></td>
                <td><span className="block font-medium">{r.name}{r.variantName && ` · ${r.variantName}`}</span><span className="font-mono text-xs text-muted">{r.sku}</span></td>
                <td className="text-right">{formatQty(r.onHand)}</td>
                <td className="hidden text-right md:table-cell text-muted">{formatQty(r.onOrder)}</td>
                <td className="hidden text-right md:table-cell text-muted">{formatQty(r.sold30)}</td>
                <td className="hidden text-right lg:table-cell text-muted">{formatQty(r.reorderPoint)}</td>
                <td><input className="field !min-h-9 !py-1" inputMode="decimal" aria-label={`Cantidad de ${r.name}`} value={r.qty} onChange={(e) => set(r.variantId, { qty: e.target.value.replace(/[^0-9.]/g, "") })} /></td>
                <td>
                  <select className="field !min-h-9 !py-1" aria-label={`Proveedor de ${r.name}`} value={r.sup} onChange={(e) => set(r.variantId, { sup: e.target.value })}>
                    <option value="">Sin proveedor</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </td>
                <td><input className="field !min-h-9 !py-1" inputMode="decimal" aria-label={`Costo de ${r.name}`} placeholder="0.00" value={r.cost} onChange={(e) => set(r.variantId, { cost: e.target.value.replace(/[^0-9.,]/g, "") })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={create} disabled={pending || selected.length === 0}>{pending ? "Creando…" : `Crear órdenes en borrador (${selected.length})`}</Button>
        <span className="text-sm text-muted">Se crea una orden por proveedor.</span>
      </div>
    </div>
  );
}
