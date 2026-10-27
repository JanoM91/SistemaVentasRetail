"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button } from "@/components/ui";
import { formatCents, formatQty } from "@/lib/money";
import { recordCountAction } from "../../actions";

type Line = { variantId: string; sku: string; name: string; variantName: string; allowsDecimals: boolean; systemQty: number | null; countedQty: number | null; difference: number | null; diffValue: number | null };

/**
 * Captura del conteo. Conteo "a ciegas": quien cuenta no ve la existencia del
 * sistema; quien autoriza ve existencias y diferencias para revisar.
 */
export function CountCapture({ countId, lines, editable, review, currency }: { countId: string; lines: Line[]; editable: boolean; review: boolean; currency: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "pending" | "diff">("all");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = Object.entries(draft).filter(([, v]) => v !== "");

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    return lines.filter((l) => {
      if (t && !`${l.name} ${l.variantName} ${l.sku}`.toLowerCase().includes(t)) return false;
      if (only === "pending") return l.countedQty === null;
      if (only === "diff") return l.difference !== null && l.difference !== 0;
      return true;
    });
  }, [lines, q, only]);

  function save() {
    setMsg(null);
    start(async () => {
      const res = await recordCountAction(countId, dirty.map(([variantId, countedQty]) => ({ variantId, countedQty })));
      if (res.ok) {
        setMsg({ ok: true, text: `Se guardaron ${res.data.saved} producto(s).` });
        setDraft({});
        router.refresh();
      } else setMsg({ ok: false, text: res.error });
    });
  }

  const counted = lines.filter((l) => l.countedQty !== null).length;
  return (
    <div className="space-y-3">
      {msg && <Alert tone={msg.ok ? "success" : "danger"} title={msg.text} />}
      <div className="flex flex-wrap items-center gap-2">
        <input className="field max-w-xs" placeholder="Buscar o escanear" aria-label="Buscar producto" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="field !w-auto" aria-label="Mostrar" value={only} onChange={(e) => setOnly(e.target.value as typeof only)}>
          <option value="all">Todos ({lines.length})</option>
          <option value="pending">Sin contar ({lines.length - counted})</option>
          {review && <option value="diff">Con diferencia</option>}
        </select>
        {editable && <Button type="button" onClick={save} disabled={pending || dirty.length === 0}>{pending ? "Guardando…" : `Guardar captura (${dirty.length})`}</Button>}
      </div>
      <div className="overflow-x-auto rounded-app border border-border bg-surface">
        <table className="table">
          <thead>
            <tr>
              <th>Producto</th>
              {review && <th className="text-right">Sistema</th>}
              <th className="w-32">Contado</th>
              {review && <th className="text-right">Diferencia</th>}
              {review && <th className="hidden text-right md:table-cell">Valor</th>}
            </tr>
          </thead>
          <tbody>
            {visible.map((l) => (
              <tr key={l.variantId}>
                <td><span className="block font-medium">{l.name}{l.variantName && ` · ${l.variantName}`}</span><span className="font-mono text-xs text-muted">{l.sku}</span></td>
                {review && <td className="text-right text-muted">{l.systemQty === null ? "—" : formatQty(l.systemQty)}</td>}
                <td>
                  {editable ? (
                    <input
                      className="field !min-h-9 !py-1"
                      inputMode={l.allowsDecimals ? "decimal" : "numeric"}
                      aria-label={`Contado de ${l.name}`}
                      placeholder={l.countedQty === null ? "" : formatQty(l.countedQty)}
                      value={draft[l.variantId] ?? ""}
                      onChange={(e) => setDraft({ ...draft, [l.variantId]: e.target.value.replace(l.allowsDecimals ? /[^0-9.]/g : /\D/g, "") })}
                    />
                  ) : l.countedQty === null ? "—" : formatQty(l.countedQty)}
                  {editable && l.countedQty !== null && draft[l.variantId] === undefined && <span className="text-xs text-success">capturado</span>}
                </td>
                {review && <td className={`text-right font-medium ${l.difference ? (l.difference < 0 ? "text-danger" : "text-success") : ""}`}>{l.difference === null ? "—" : `${l.difference > 0 ? "+" : ""}${formatQty(l.difference)}`}</td>}
                {review && <td className="hidden text-right md:table-cell">{l.diffValue === null ? "—" : formatCents(l.diffValue, currency)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
