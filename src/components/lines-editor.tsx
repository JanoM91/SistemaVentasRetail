"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { VariantPicker, type PickedVariant } from "@/components/variant-picker";
import { formatCents, parseMoney, roundHalfEven } from "@/lib/money";

export type DocLine = { key: string; variant: PickedVariant; quantity: string; unitCost: string; hint?: string };

let seq = 0;
export const newLineKey = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * Editor de partidas para documentos de inventario y compras: buscar producto,
 * cantidad y (opcional) costo unitario sin IVA. Si `costHint` está presente se
 * usa para precargar el costo al agregar un producto.
 */
export function LinesEditor({
  lines,
  onChange,
  withCost,
  currency,
  costHint,
  qtyLabel = "Cantidad",
  emptyText = "Busca y agrega productos.",
}: {
  lines: DocLine[];
  onChange: (lines: DocLine[]) => void;
  withCost: boolean;
  currency: string;
  costHint?: (variantId: string) => Promise<number | null>;
  qtyLabel?: string;
  emptyText?: string;
}) {
  const [error, setError] = useState<string | null>(null);

  async function add(v: PickedVariant | null) {
    if (!v) return;
    setError(null);
    if (!v.trackStock) {
      setError(`${v.name} no controla inventario.`);
      return;
    }
    const existing = lines.find((l) => l.variant.id === v.id);
    if (existing) {
      onChange(lines.map((l) => (l === existing ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l)));
      return;
    }
    const key = newLineKey();
    const next = [...lines, { key, variant: v, quantity: "1", unitCost: "" }];
    onChange(next);
    if (withCost && costHint) {
      const c = await costHint(v.id).catch(() => null);
      if (c !== null && c !== undefined) onChange(next.map((l) => (l.key === key && !l.unitCost ? { ...l, unitCost: (c / 100).toFixed(2), hint: "último costo" } : l)));
    }
  }
  const set = (key: string, patch: Partial<DocLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch, hint: patch.unitCost !== undefined ? undefined : l.hint } : l)));
  const subtotal = lines.reduce((a, l) => a + roundHalfEven((Number(l.quantity) || 0) * (parseMoney(l.unitCost) ?? 0)), 0);

  return (
    <div className="space-y-3">
      <VariantPicker value={null} onChange={add} currency={currency} />
      {error && <p className="text-sm text-danger">{error}</p>}
      {lines.length === 0 ? (
        <p className="rounded-app border border-dashed border-border px-4 py-6 text-center text-sm text-muted">{emptyText}</p>
      ) : (
        <div className="overflow-x-auto rounded-app border border-border">
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="w-28">{qtyLabel}</th>
                {withCost && <th className="w-36">Costo unit. <span className="font-normal normal-case">(sin IVA)</span></th>}
                {withCost && <th className="text-right">Importe</th>}
                <th className="w-10"><span className="sr-only">Quitar</span></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key}>
                  <td>
                    <span className="block font-medium">{l.variant.name}{l.variant.variantName && ` · ${l.variant.variantName}`}</span>
                    <span className="block font-mono text-xs text-muted">{l.variant.sku}</span>
                  </td>
                  <td>
                    <input className="field !min-h-9 !py-1" inputMode="decimal" aria-label={`${qtyLabel} de ${l.variant.name}`} value={l.quantity} onChange={(e) => set(l.key, { quantity: e.target.value.replace(/[^0-9.]/g, "") })} />
                  </td>
                  {withCost && (
                    <td>
                      <div className="relative">
                        <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-muted">$</span>
                        <input className="field !min-h-9 !py-1 pl-5" inputMode="decimal" aria-label={`Costo de ${l.variant.name}`} placeholder="0.00" value={l.unitCost} onChange={(e) => set(l.key, { unitCost: e.target.value.replace(/[^0-9.,]/g, "") })} />
                      </div>
                      {l.hint && <span className="text-xs text-muted">{l.hint}</span>}
                    </td>
                  )}
                  {withCost && <td className="text-right">{formatCents(roundHalfEven((Number(l.quantity) || 0) * (parseMoney(l.unitCost) ?? 0)), currency)}</td>}
                  <td>
                    <button type="button" className="rounded p-1 text-muted hover:text-danger" aria-label={`Quitar ${l.variant.name}`} onClick={() => onChange(lines.filter((x) => x.key !== l.key))}>
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            {withCost && (
              <tfoot>
                <tr>
                  <td colSpan={3} className="text-right text-sm text-muted">Subtotal sin IVA</td>
                  <td className="text-right font-semibold">{formatCents(subtotal, currency)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
