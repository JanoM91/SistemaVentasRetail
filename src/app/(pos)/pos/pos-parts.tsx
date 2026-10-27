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
  /** Para promociones por categoría. */
  categoryId?: string | null;
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
  promos = [],
}: {
  lines: CartLine[];
  /** Descuento por promoción de cada línea (mismo orden). `lines` ya trae el descuento total. */
  promos?: number[];
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
                {a.discount - (promos[i] ?? 0) > 0 && <p className="text-xs text-success">Descuento −{formatCents(a.discount - (promos[i] ?? 0), currency)}</p>}
                {(promos[i] ?? 0) > 0 && <p className="text-xs text-success" data-testid="line-promo">Promoción −{formatCents(promos[i], currency)}</p>}
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

export type Tender = { methodId: string; amount: number; received: number | null; reference: string };
export type CreditInfo = { name: string; available: number; overdue: number; blocked: boolean } | null;

/**
 * Cobro con uno o varios pagos (p. ej. parte en tarjeta y el resto en
 * efectivo). Solo el efectivo da cambio. "Crédito del cliente" aparece cuando
 * la venta tiene un cliente con crédito autorizado.
 */
export function PaymentModal({
  total,
  currency,
  methods,
  online,
  busy,
  error,
  credit,
  canCreditSale,
  forceAuth,
  initialTenders = [],
  onConfirm,
  onClose,
}: {
  total: number;
  currency: string;
  methods: PosCatalog["paymentMethods"];
  online: boolean;
  busy: boolean;
  error: string | null;
  credit: CreditInfo;
  canCreditSale: boolean;
  forceAuth: boolean;
  /** Pagos ya definidos (p. ej. el vale de un cambio). */
  initialTenders?: Tender[];
  onConfirm: (tenders: Tender[], auth?: { username: string; password: string }) => void;
  onClose: () => void;
}) {
  const visible = methods.filter((m) => m.kind !== "customer_credit" || (credit && !credit.blocked));
  const cash = visible.find((m) => m.kind === "cash") ?? visible[0];
  const [tenders, setTenders] = useState<Tender[]>(initialTenders);
  const [methodId, setMethodId] = useState(cash?.id ?? "");
  const [value, setValue] = useState("");
  const [reference, setReference] = useState("");
  const [authUser, setAuthUser] = useState("");
  const [authPass, setAuthPass] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const method = visible.find((m) => m.id === methodId);
  const name = (id: string) => methods.find((m) => m.id === id)?.name ?? "";
  const paid = tenders.reduce((a, t) => a + t.amount, 0);
  const remaining = total - paid;
  const isCash = method?.kind === "cash" || !!method?.allowsChange;
  const isCredit = method?.kind === "customer_credit";
  const typed = value ? parseMoney(value) : null;
  const creditDefault = credit ? Math.min(remaining, Math.max(0, credit.available)) || remaining : remaining;
  const entered = typed ?? (isCredit ? creditDefault : remaining);
  const applied = isCash ? Math.min(entered, remaining) : entered;
  const change = isCash ? entered - remaining : 0;
  const creditUsed = (isCredit ? applied : 0) + tenders.filter((t) => methods.find((m) => m.id === t.methodId)?.kind === "customer_credit").reduce((a, t) => a + t.amount, 0);
  const needsAuth = creditUsed > 0 && (forceAuth || !canCreditSale || (credit !== null && (creditUsed > credit.available || credit.overdue > 0)));
  const completes = applied >= remaining && remaining > 0;
  /** Los pagos ya capturados cubren el total (p. ej. el vale de un cambio). */
  const fullyPaid = remaining === 0 && tenders.length > 0;
  const quick = useMemo(() => {
    const opts = new Set<number>([remaining]);
    for (const step of [2000, 5000, 10000, 20000, 50000]) opts.add(Math.ceil(remaining / step) * step);
    return [...opts].filter((v) => v >= remaining).sort((a, b) => a - b).slice(0, 5);
  }, [remaining]);
  const invalidEntry =
    !method ||
    entered === null ||
    entered <= 0 ||
    (!isCash && entered > remaining) ||
    (!isCash && method.requiresReference && !reference.trim()) ||
    (!online && method.kind !== "cash") ||
    (isCredit && tenders.some((t) => t.methodId === method.id));
  const invalid = invalidEntry || (needsAuth && (!online || !authUser || !authPass));

  useEffect(() => inputRef.current?.focus(), [methodId, tenders.length]);
  const current = (): Tender => ({ methodId, amount: applied, received: isCash ? entered : null, reference: reference.trim() });
  const reset = () => {
    setValue("");
    setReference("");
    setMethodId(cash?.id ?? "");
  };
  const addPartial = () => {
    if (invalidEntry || completes) return;
    setTenders((t) => [...t, current()]);
    reset();
  };
  const submit = () => {
    if (busy) return;
    if (fullyPaid) {
      if (needsAuth && (!authUser || !authPass)) return;
      return onConfirm(tenders, needsAuth ? { username: authUser, password: authPass } : undefined);
    }
    if (!completes) return addPartial();
    if (invalid) return;
    onConfirm([...tenders, current()], needsAuth ? { username: authUser, password: authPass } : undefined);
  };

  return (
    <Modal title="Cobrar" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-surface-2 p-4 text-center">
          <div>
            <p className="text-sm text-muted">Total</p>
            <p className="text-3xl font-bold" data-testid="pay-total">{formatCents(total, currency)}</p>
          </div>
          <div>
            <p className="text-sm text-muted">{tenders.length ? "Falta" : "Por cobrar"}</p>
            <p className={`text-3xl font-bold ${tenders.length ? "text-primary" : ""}`} data-testid="pay-remaining">{formatCents(remaining, currency)}</p>
          </div>
        </div>
        {tenders.length > 0 && (
          <ul className="divide-y divide-border rounded-app border border-border text-sm" data-testid="tenders">
            {tenders.map((t, i) => (
              <li key={i} className="flex items-center justify-between px-3 py-2">
                <span>{name(t.methodId)}{t.reference && <span className="text-muted"> · {t.reference}</span>}</span>
                <span className="flex items-center gap-2 font-medium">{formatCents(t.amount, currency)}
                  <button type="button" className="rounded p-1 text-danger" aria-label={`Quitar pago ${name(t.methodId)}`} onClick={() => setTenders((x) => x.filter((_, j) => j !== i))}><X className="size-4" /></button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-2 gap-2">
          {visible.map((m) => {
            const disabled = (!online && m.kind !== "cash") || (m.kind === "customer_credit" && tenders.some((t) => t.methodId === m.id));
            return (
              <button type="button" key={m.id} disabled={disabled} onClick={() => { setMethodId(m.id); setValue(""); }} className={`rounded-app border px-3 py-3 text-sm font-medium disabled:opacity-40 ${methodId === m.id ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>
                {m.name}
              </button>
            );
          })}
        </div>
        {!online && <p className="text-xs text-warning">Sin conexión solo se acepta efectivo.</p>}
        {isCredit && credit && (
          <p className="rounded-app bg-surface-2 p-2 text-sm">
            {credit.name}: disponible <b>{formatCents(credit.available, currency)}</b>{credit.overdue > 0 && <span className="text-danger"> · vencido {formatCents(credit.overdue, currency)}</span>}
          </p>
        )}
        {isCash ? (
          <>
            <label className="block text-sm font-medium">Efectivo recibido
              <input ref={inputRef} className="field mt-1 text-2xl" inputMode="decimal" placeholder={(remaining / 100).toFixed(2)} value={value} onChange={(e) => setValue(e.target.value)} data-testid="received" />
            </label>
            <div className="flex flex-wrap gap-2">
              {quick.map((q) => (
                <button type="button" key={q} onClick={() => setValue((q / 100).toFixed(2))} className="rounded-app border border-border px-3 py-2 text-sm hover:bg-surface-2">{q === remaining ? "Exacto" : formatCents(q, currency)}</button>
              ))}
            </div>
            <div className={`rounded-xl p-3 text-center ${change >= 0 ? "bg-success/10" : "bg-surface-2"}`}>
              <p className="text-sm text-muted">{change >= 0 ? "Cambio" : "Quedará por cobrar"}</p>
              <p className="text-3xl font-bold" data-testid="change">{formatCents(Math.abs(change), currency)}</p>
            </div>
          </>
        ) : (
          <>
            <label className="block text-sm font-medium">Importe
              <input ref={inputRef} className="field mt-1 text-2xl" inputMode="decimal" placeholder={((isCredit ? creditDefault : remaining) / 100).toFixed(2)} value={value} onChange={(e) => setValue(e.target.value)} data-testid="tender-amount" />
            </label>
            {method?.requiresReference && (
              <label className="block text-sm font-medium">{method.kind === "prepaid" ? "Folio del vale" : "Referencia / autorización"}
                <input className="field mt-1" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={method.kind === "prepaid" ? "D-000001" : "Autorización de la terminal o folio de transferencia"} data-testid="tender-reference" />
              </label>
            )}
          </>
        )}
        {needsAuth && (
          <div className="space-y-2 rounded-app border border-warning/50 bg-warning/10 p-3">
            <p className="text-sm font-medium">{!canCreditSale ? "Vender a crédito requiere autorización de un gerente" : "Excede el crédito disponible o tiene saldo vencido: requiere autorización"}</p>
            <input className="field" placeholder="Usuario del gerente" value={authUser} onChange={(e) => setAuthUser(e.target.value)} autoComplete="off" aria-label="Usuario autorizador" />
            <input className="field" type="password" placeholder="Contraseña" value={authPass} onChange={(e) => setAuthPass(e.target.value)} autoComplete="off" aria-label="Contraseña del autorizador" />
          </div>
        )}
        {error && <p className="rounded-app bg-danger-bg p-3 text-sm text-danger" role="alert">{error}</p>}
        {completes || fullyPaid ? (
          <button type="submit" disabled={(fullyPaid ? needsAuth && (!authUser || !authPass) : invalid) || busy} className="w-full rounded-xl bg-primary py-4 text-lg font-semibold text-primary-fg disabled:opacity-50" data-testid="confirm-sale">
            {busy ? "Registrando…" : "Confirmar venta (Enter)"}
          </button>
        ) : (
          <button type="submit" disabled={invalidEntry || busy} className="w-full rounded-xl border-2 border-primary py-4 text-lg font-semibold text-primary disabled:opacity-50" data-testid="add-tender">
            Agregar pago de {formatCents(Math.max(0, applied), currency)} · faltan {formatCents(Math.max(0, remaining - applied), currency)}
          </button>
        )}
      </form>
    </Modal>
  );
}
