"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Minus, Plus, Trash2, X } from "lucide-react";
import { computeLine, formatCents, formatQty, parseMoney } from "@/lib/money";
import type { PosCatalog, PosItem } from "@/server/modules/pos/catalog";

export type CartLine = {
  variantId: string;
  productId: string;
  name: string;
  variantName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  taxIncluded: boolean;
  allowsDecimals: boolean;
  stock: number | null;
};

export const lineAmounts = (l: CartLine) => computeLine({ unitPrice: l.unitPrice, quantity: l.quantity, discount: l.discount, taxRate: l.taxRate, taxIncluded: l.taxIncluded });

/** Normaliza texto para búsqueda (sin acentos, minúsculas). */
export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ---------------------------------------------------------------- Modal genérico

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`max-h-[92dvh] w-full overflow-auto rounded-t-2xl bg-surface p-5 shadow-2xl sm:rounded-2xl ${wide ? "sm:max-w-2xl" : "sm:max-w-md"}`}>
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="rounded-app p-2 hover:bg-surface-2" onClick={onClose} aria-label="Cerrar"><X className="size-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Productos

export type ProductTile = { productId: string; name: string; variants: PosItem[]; minPrice: number; stock: number | null; isFavorite: boolean };

export function groupProducts(items: PosItem[]): ProductTile[] {
  const map = new Map<string, ProductTile>();
  for (const it of items) {
    const t = map.get(it.productId) ?? { productId: it.productId, name: it.name, variants: [], minPrice: it.price, stock: it.trackStock ? 0 : null, isFavorite: it.isFavorite };
    t.variants.push(it);
    t.minPrice = Math.min(t.minPrice, it.price);
    if (t.stock !== null && it.stock !== null) t.stock += it.stock;
    map.set(it.productId, t);
  }
  return [...map.values()];
}

export function ProductGrid({ tiles, currency, onPick }: { tiles: ProductTile[]; currency: string; onPick: (t: ProductTile) => void }) {
  if (!tiles.length) return <p className="p-6 text-center text-sm text-muted">Sin productos. Escribe para buscar o escanea un código.</p>;
  return (
    <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3 xl:grid-cols-4" data-testid="product-grid">
      {tiles.map((t) => (
        <button
          key={t.productId}
          onClick={() => onPick(t)}
          className="flex min-h-24 flex-col justify-between rounded-xl border border-border bg-surface p-3 text-left shadow-sm transition hover:border-primary active:scale-[0.98]"
        >
          <span className="line-clamp-2 text-sm font-medium leading-tight">{t.name}</span>
          <span className="mt-2 flex items-end justify-between gap-1">
            <span className="text-base font-semibold">{t.variants.length > 1 ? "desde " : ""}{formatCents(t.minPrice, currency)}</span>
            {t.stock !== null && <span className={`text-xs ${t.stock <= 0 ? "text-danger" : "text-muted"}`}>{formatQty(t.stock)}</span>}
          </span>
          {t.variants.length > 1 && <span className="text-xs text-muted">{t.variants.length} variantes</span>}
        </button>
      ))}
    </div>
  );
}

export function VariantModal({ tile, currency, onPick, onClose }: { tile: ProductTile; currency: string; onPick: (v: PosItem) => void; onClose: () => void }) {
  return (
    <Modal title={tile.name} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tile.variants.map((v) => (
          <button key={v.variantId} onClick={() => onPick(v)} className="rounded-xl border border-border p-3 text-left hover:border-primary">
            <span className="block font-medium">{v.variantName || "Única"}</span>
            <span className="block font-mono text-xs text-muted">{v.sku}</span>
            <span className="mt-1 flex justify-between text-sm">
              <span className="font-semibold">{formatCents(v.price, currency)}</span>
              {v.stock !== null && <span className={v.stock <= 0 ? "text-danger" : "text-muted"}>{formatQty(v.stock)}</span>}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Carrito

export function CartView({
  lines,
  currency,
  onQty,
  onRemove,
  onDiscount,
}: {
  lines: CartLine[];
  currency: string;
  onQty: (i: number, q: number) => void;
  onRemove: (i: number) => void;
  onDiscount: (i: number) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  if (!lines.length) return <p className="p-6 text-center text-sm text-muted">Carrito vacío</p>;
  return (
    <ul className="divide-y divide-border" data-testid="cart">
      {lines.map((l, i) => {
        const a = lineAmounts(l);
        const over = l.stock !== null && l.quantity > l.stock;
        return (
          <li key={l.variantId} className="px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{l.name}{l.variantName && <span className="text-muted"> · {l.variantName}</span>}</p>
                <p className="text-xs text-muted">{formatCents(l.unitPrice, currency)} c/u{over && <span className="text-warning"> · solo hay {formatQty(l.stock!)}</span>}</p>
                {l.discount > 0 && <p className="text-xs text-success">Descuento −{formatCents(a.discount, currency)}</p>}
              </div>
              <p className="shrink-0 text-sm font-semibold">{formatCents(a.total, currency)}</p>
            </div>
            <div className="mt-1 flex items-center gap-1">
              <button className="rounded-lg border border-border p-2 hover:bg-surface-2" onClick={() => onQty(i, l.quantity - 1)} aria-label="Quitar uno"><Minus className="size-4" /></button>
              {editing === i ? (
                <input
                  autoFocus
                  className="field !min-h-9 w-20 !py-1 text-center"
                  inputMode="decimal"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => { const q = Number(draft.replace(",", ".")); if (q > 0) onQty(i, q); setEditing(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  aria-label="Cantidad"
                />
              ) : (
                <button className="min-w-12 rounded-lg px-2 py-1.5 text-center font-semibold hover:bg-surface-2" onClick={() => { setDraft(String(l.quantity)); setEditing(i); }} aria-label="Editar cantidad">{formatQty(l.quantity)}</button>
              )}
              <button className="rounded-lg border border-border p-2 hover:bg-surface-2" onClick={() => onQty(i, l.quantity + 1)} aria-label="Agregar uno"><Plus className="size-4" /></button>
              <button className="ml-auto rounded-lg px-2 py-1.5 text-xs text-primary hover:bg-surface-2" onClick={() => onDiscount(i)}>Descuento</button>
              <button className="rounded-lg p-2 text-danger hover:bg-surface-2" onClick={() => onRemove(i)} aria-label="Quitar producto"><Trash2 className="size-4" /></button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- Descuento

export function DiscountModal({
  line,
  currency,
  maxPct,
  needsAuth,
  online,
  onApply,
  onClose,
}: {
  line: CartLine;
  currency: string;
  maxPct: number;
  needsAuth: boolean;
  online: boolean;
  onApply: (discount: number, auth?: { username: string; password: string }) => void;
  onClose: () => void;
}) {
  const gross = lineAmounts({ ...line, discount: 0 }).gross;
  const [mode, setMode] = useState<"pct" | "amount">("pct");
  const [value, setValue] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const discount = mode === "pct" ? Math.round((gross * (Number(value) || 0)) / 100) : (parseMoney(value) ?? 0);
  const pct = gross ? (discount / gross) * 100 : 0;
  const tooMuch = pct > maxPct + 1e-9;
  return (
    <Modal title={`Descuento · ${line.name}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <button className={`flex-1 rounded-app border px-3 py-2 ${mode === "pct" ? "border-primary bg-primary/10" : "border-border"}`} onClick={() => setMode("pct")}>Porcentaje</button>
          <button className={`flex-1 rounded-app border px-3 py-2 ${mode === "amount" ? "border-primary bg-primary/10" : "border-border"}`} onClick={() => setMode("amount")}>Importe</button>
        </div>
        <input autoFocus className="field text-lg" inputMode="decimal" placeholder={mode === "pct" ? "10" : "0.00"} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Valor del descuento" />
        <p className="text-sm">Descuento: <b>{formatCents(discount, currency)}</b> ({pct.toFixed(1)} %) · máximo {maxPct} %</p>
        {tooMuch && <p className="text-sm text-danger">Supera el máximo permitido.</p>}
        {needsAuth && (
          online ? (
            <div className="space-y-2 rounded-app border border-warning/50 bg-warning/10 p-3">
              <p className="text-sm font-medium">Requiere autorización de un gerente</p>
              <input className="field" placeholder="Usuario del gerente" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
              <input className="field" type="password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
              <p className="text-xs text-muted">Se valida al cobrar.</p>
            </div>
          ) : (
            <p className="text-sm text-danger">Sin conexión no se pueden autorizar descuentos.</p>
          )
        )}
        <div className="flex gap-2">
          <button className="flex-1 rounded-app border border-border px-4 py-3" onClick={() => onApply(0)}>Quitar descuento</button>
          <button
            className="flex-1 rounded-app bg-primary px-4 py-3 font-medium text-primary-fg disabled:opacity-50"
            disabled={tooMuch || discount <= 0 || (needsAuth && (!online || !username || !password))}
            onClick={() => onApply(discount, needsAuth ? { username, password } : undefined)}
          >
            Aplicar
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Cobro

export type PaymentChoice = { methodId: string; received: number | null; reference: string };

export function PaymentModal({
  total,
  currency,
  methods,
  online,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  total: number;
  currency: string;
  methods: PosCatalog["paymentMethods"];
  online: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: (p: PaymentChoice) => void;
  onClose: () => void;
}) {
  const cash = methods.find((m) => m.kind === "cash") ?? methods[0];
  const [methodId, setMethodId] = useState(cash?.id ?? "");
  const [received, setReceived] = useState("");
  const [reference, setReference] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const method = methods.find((m) => m.id === methodId);
  const isCash = method?.kind === "cash" || method?.allowsChange;
  const receivedCents = received ? parseMoney(received) : total;
  const change = isCash && receivedCents !== null ? receivedCents - total : 0;
  const quick = useMemo(() => {
    const opts = new Set<number>([total]);
    for (const step of [2000, 5000, 10000, 20000, 50000]) opts.add(Math.ceil(total / step) * step);
    return [...opts].filter((v) => v >= total).sort((a, b) => a - b).slice(0, 5);
  }, [total]);
  const invalid = !method || (isCash && (receivedCents === null || receivedCents < total)) || (!isCash && method.requiresReference && !reference.trim()) || (!online && method.kind !== "cash");

  useEffect(() => inputRef.current?.focus(), [methodId]);
  const submit = () => !invalid && !busy && onConfirm({ methodId, received: isCash ? receivedCents : null, reference: reference.trim() });

  return (
    <Modal title="Cobrar" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4">
        <div className="rounded-xl bg-surface-2 p-4 text-center">
          <p className="text-sm text-muted">Total a pagar</p>
          <p className="text-4xl font-bold" data-testid="pay-total">{formatCents(total, currency)}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {methods.map((m) => {
            const disabled = !online && m.kind !== "cash";
            return (
              <button type="button" key={m.id} disabled={disabled} onClick={() => setMethodId(m.id)} className={`rounded-app border px-3 py-3 text-sm font-medium disabled:opacity-40 ${methodId === m.id ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>
                {m.name}
              </button>
            );
          })}
        </div>
        {!online && <p className="text-xs text-warning">Sin conexión solo se acepta efectivo.</p>}
        {isCash ? (
          <>
            <label className="block text-sm font-medium">Efectivo recibido
              <input ref={inputRef} className="field mt-1 text-2xl" inputMode="decimal" placeholder={(total / 100).toFixed(2)} value={received} onChange={(e) => setReceived(e.target.value)} data-testid="received" />
            </label>
            <div className="flex flex-wrap gap-2">
              {quick.map((q) => (
                <button type="button" key={q} onClick={() => setReceived((q / 100).toFixed(2))} className="rounded-app border border-border px-3 py-2 text-sm hover:bg-surface-2">{q === total ? "Exacto" : formatCents(q, currency)}</button>
              ))}
            </div>
            <div className={`rounded-xl p-3 text-center ${change >= 0 ? "bg-success/10" : "bg-danger/10"}`}>
              <p className="text-sm text-muted">{change >= 0 ? "Cambio" : "Falta"}</p>
              <p className="text-3xl font-bold" data-testid="change">{formatCents(Math.abs(change), currency)}</p>
            </div>
          </>
        ) : (
          method?.requiresReference && (
            <label className="block text-sm font-medium">Referencia / autorización
              <input ref={inputRef} className="field mt-1" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Número de autorización de la terminal o folio de transferencia" />
            </label>
          )
        )}
        {error && <p className="rounded-app bg-danger-bg p-3 text-sm text-danger" role="alert">{error}</p>}
        <button type="submit" disabled={invalid || busy} className="w-full rounded-xl bg-primary py-4 text-lg font-semibold text-primary-fg disabled:opacity-50" data-testid="confirm-sale">
          {busy ? "Registrando…" : "Confirmar venta (Enter)"}
        </button>
      </form>
    </Modal>
  );
}
