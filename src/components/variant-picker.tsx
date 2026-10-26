"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { formatCents } from "@/lib/money";

export type PickedVariant = { id: string; sku: string; name: string; variantName: string; price: number; trackStock: boolean };

/** Buscador de variantes por nombre, SKU o código de barras (acepta lector de códigos). */
export function VariantPicker({ value, onChange, currency = "MXN", autoFocus }: { value: PickedVariant | null; onChange: (v: PickedVariant | null) => void; currency?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickedVariant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/v1/catalog/variants?q=${encodeURIComponent(q.trim())}`);
        const json = await res.json();
        if (!json.ok) throw new Error(json.error);
        setResults(json.data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo buscar.");
      } finally {
        setLoading(false);
      }
    }, 200);
  }, [q]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-app border border-primary bg-primary/10 px-3 py-2">
        <div>
          <p className="font-medium">{value.name}{value.variantName && ` · ${value.variantName}`}</p>
          <p className="font-mono text-xs text-muted">{value.sku}</p>
        </div>
        <button type="button" className="text-sm text-primary underline" onClick={() => onChange(null)}>Cambiar</button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-3 size-5 text-muted" aria-hidden />
      <input
        className="field pl-10"
        placeholder="Nombre, SKU o escanea el código"
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (results.length === 1) onChange(results[0]);
          }
        }}
        aria-label="Buscar producto"
      />
      {(results.length > 0 || loading || error) && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-app border border-border bg-surface shadow-lg" role="listbox">
          {loading && <li className="px-3 py-2 text-sm text-muted">Buscando…</li>}
          {error && <li className="px-3 py-2 text-sm text-danger">{error}</li>}
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface-2" onClick={() => { onChange(r); setQ(""); setResults([]); }}>
                <span>
                  <span className="block text-sm font-medium">{r.name}{r.variantName && ` · ${r.variantName}`}</span>
                  <span className="block font-mono text-xs text-muted">{r.sku}{!r.trackStock && " · no controla inventario"}</span>
                </span>
                <span className="text-sm text-muted">{formatCents(r.price, currency)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
