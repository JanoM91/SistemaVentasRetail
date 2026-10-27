"use client";

import { useMemo, useRef, useState } from "react";
import { Search, Trash2 } from "lucide-react";
import { computeLine, formatCents, formatQty, normalizeQty, roundHalfEven } from "@/lib/money";
import { uuidv7 } from "@/lib/pos/local-db";
import { CLIENT_HEADERS } from "@/lib/pos/sync";
import type { PosItem } from "@/server/modules/pos/catalog";
import { Modal, norm } from "./pos-parts";

type ReturnableSale = {
  sale: { id: string; folio: string; soldAt: string; total: number; customerId: string | null; customerName: string | null };
  lines: Array<{ saleLineId: string; variantId: string; sku: string; description: string; quantity: number; returnedQty: number; returnableQty: number; lineTotal: number; returnableAmount: number }>;
  payments: Array<{ methodId: string; name: string; kind: string; amount: number }>;
  priorReturns: Array<{ folio: string; total: number }>;
  ageDays: number;
  outOfPolicy: boolean;
  policy: { maxDays: number; allowWithoutTicket: boolean; cashRefundNeedsAuthorization: boolean };
};

export type ReturnResult = {
  id: string;
  folio: string;
  total: number;
  refundMethod: "cash" | "original" | "customer_account" | "store_credit";
  storeCreditBalance: number;
  createdAt: string;
  lines: Array<{ description: string; sku: string; quantity: number; total: number; restock: boolean }>;
  saleFolio: string | null;
  customerName: string | null;
  refundLabel: string;
  exchange: boolean;
};

const REASONS = [
  ["defective", "Defectuoso"],
  ["wrong_item", "Equivocado / otra talla"],
  ["changed_mind", "Ya no lo quiere"],
  ["expired", "Caducado"],
  ["other", "Otro"],
] as const;

type Choice = "cash" | "original" | "customer_account" | "store_credit" | "exchange";

export function ReturnModal({
  registerId,
  items,
  currency,
  can,
  onDone,
  onClose,
}: {
  registerId: string;
  items: PosItem[];
  currency: string;
  can: { authorize: boolean; noTicket: boolean };
  onDone: (r: ReturnResult) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"find" | "detail">("find");
  const [folio, setFolio] = useState("");
  const [sale, setSale] = useState<ReturnableSale | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [noTicketLines, setNoTicketLines] = useState<Array<{ item: PosItem; qty: string; restock: boolean }>>([]);
  const [search, setSearch] = useState("");
  const [reasonCode, setReasonCode] = useState<(typeof REASONS)[number][0]>("defective");
  const [reason, setReason] = useState("");
  const [choice, setChoice] = useState<Choice>("store_credit");
  const [originalMethod, setOriginalMethod] = useState("");
  const [reference, setReference] = useState("");
  const [authUser, setAuthUser] = useState("");
  const [authPass, setAuthPass] = useState("");
  const [forceAuth, setForceAuth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(uuidv7());
  const noTicket = step === "detail" && !sale;

  async function find() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/returns/sale?folio=${encodeURIComponent(folio.trim())}`, { credentials: "same-origin" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      const s = json.data as ReturnableSale;
      setSale(s);
      setQty({});
      setRestock(Object.fromEntries(s.lines.map((l) => [l.saleLineId, true])));
      const electronic = s.payments.filter((p) => !["cash", "customer_credit", "prepaid"].includes(p.kind));
      setOriginalMethod(electronic[0]?.methodId ?? "");
      setChoice(s.payments.some((p) => p.kind === "customer_credit") ? "customer_account" : electronic.length && !s.payments.some((p) => p.kind === "cash") ? "original" : "cash");
      setStep("detail");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se encontró la venta.");
    } finally {
      setBusy(false);
    }
  }

  const ticketTotal = sale
    ? sale.lines.reduce((a, l) => {
        const q = normalizeQty(Number(qty[l.saleLineId] || 0));
        if (q <= 0) return a;
        return a + (Math.abs(q - l.returnableQty) < 1e-9 ? l.returnableAmount : roundHalfEven((l.lineTotal * q) / l.quantity));
      }, 0)
    : 0;
  const noTicketTotal = noTicketLines.reduce((a, l) => a + computeLine({ unitPrice: l.item.price, quantity: Number(l.qty) || 0, discount: 0, taxRate: l.item.taxRate, taxIncluded: l.item.taxIncluded }).total, 0);
  const total = sale ? ticketTotal : noTicketTotal;
  const electronic = sale?.payments.filter((p) => !["cash", "customer_credit", "prepaid"].includes(p.kind)) ?? [];
  const hadCredit = !!sale?.payments.some((p) => p.kind === "customer_credit") && !!sale?.sale.customerId;
  const overQty = sale?.lines.some((l) => Number(qty[l.saleLineId] || 0) > l.returnableQty + 1e-9) ?? false;
  const needsAuth =
    forceAuth ||
    (!!sale && sale.outOfPolicy && !can.authorize) ||
    (choice === "cash" && !!sale?.policy.cashRefundNeedsAuthorization && !can.authorize) ||
    (noTicket && !can.noTicket);

  const results = useMemo(() => {
    const q = norm(search.trim());
    if (q.length < 2) return [];
    return items.filter((it) => norm(`${it.name} ${it.variantName} ${it.sku} ${it.barcodes.join(" ")}`).includes(q)).slice(0, 8);
  }, [items, search]);

  const invalid = total <= 0 || overQty || reason.trim().length < 3 || (choice === "original" && !originalMethod) || (needsAuth && (!authUser || !authPass));

  async function submit() {
    if (invalid || busy) return;
    setBusy(true);
    setError(null);
    const refundMethod = choice === "exchange" ? "store_credit" : choice;
    const body = {
      id: idRef.current,
      cashRegisterId: registerId,
      saleId: sale?.sale.id ?? null,
      lines: sale
        ? sale.lines.filter((l) => Number(qty[l.saleLineId] || 0) > 0).map((l) => ({ saleLineId: l.saleLineId, variantId: l.variantId, quantity: Number(qty[l.saleLineId]), restock: restock[l.saleLineId] ?? true }))
        : noTicketLines.filter((l) => Number(l.qty) > 0).map((l) => ({ variantId: l.item.variantId, quantity: Number(l.qty), restock: l.restock })),
      reasonCode,
      reason: reason.trim(),
      refundMethod,
      refundPaymentMethodId: choice === "original" ? originalMethod : null,
      refundReference: reference.trim(),
      ...(needsAuth ? { authorization: { username: authUser, password: authPass } } : {}),
    };
    try {
      const res = await fetch("/api/v1/returns", { method: "POST", headers: CLIENT_HEADERS, credentials: "same-origin", body: JSON.stringify(body) });
      const json = await res.json();
      if (!json.ok) {
        if (json.code === "return_authorization_required") setForceAuth(true);
        throw new Error(json.error);
      }
      const label =
        choice === "exchange" ? "Cambio por otros productos (vale)" : choice === "store_credit" ? "Vale" : choice === "cash" ? "Efectivo" : choice === "customer_account" ? "Abono a la cuenta del cliente" : `${electronic.find((p) => p.methodId === originalMethod)?.name ?? "Mismo medio"}${reference.trim() ? ` (${reference.trim()})` : ""}`;
      onDone({ ...json.data, saleFolio: sale?.sale.folio ?? null, customerName: sale?.sale.customerName ?? null, refundLabel: label, exchange: choice === "exchange" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar la devolución.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "find") {
    return (
      <Modal title="Devolución o cambio" onClose={onClose}>
        <form onSubmit={(e) => { e.preventDefault(); if (folio.trim()) find(); }} className="space-y-3">
          <label className="block text-sm font-medium">Folio del ticket
            <input autoFocus className="field mt-1 font-mono uppercase" placeholder="V-000123" value={folio} onChange={(e) => setFolio(e.target.value)} data-testid="return-folio" />
          </label>
          {error && <p className="rounded-app bg-danger-bg p-2 text-sm text-danger" role="alert">{error}</p>}
          <button className="w-full rounded-xl bg-primary py-3 font-semibold text-primary-fg disabled:opacity-50" disabled={!folio.trim() || busy}>{busy ? "Buscando…" : "Buscar venta"}</button>
          <button type="button" className="w-full rounded-xl border border-dashed border-border py-3 text-sm" onClick={() => { setSale(null); setChoice("store_credit"); setStep("detail"); }} data-testid="return-no-ticket">
            El cliente no tiene ticket (solo vale)
          </button>
        </form>
      </Modal>
    );
  }

  const options: Array<{ key: Choice; label: string; show: boolean }> = [
    { key: "exchange", label: "Cambio por otro producto", show: true },
    { key: "store_credit", label: "Vale", show: true },
    { key: "cash", label: "Efectivo", show: !!sale },
    { key: "original", label: "Mismo medio de pago", show: electronic.length > 0 },
    { key: "customer_account", label: "Abonar a su cuenta", show: hadCredit },
  ];

  return (
    <Modal title={sale ? `Devolución de ${sale.sale.folio}` : "Devolución sin ticket"} onClose={onClose} wide>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4">
        {sale && (
          <p className="text-sm text-muted">
            {new Date(sale.sale.soldAt).toLocaleDateString("es-MX")} · hace {sale.ageDays} día(s) · total {formatCents(sale.sale.total, currency)}
            {sale.sale.customerName && ` · ${sale.sale.customerName}`}
            {sale.outOfPolicy && <span className="text-warning"> · fuera del plazo de {sale.policy.maxDays} días</span>}
            {sale.priorReturns.length > 0 && <span> · ya tiene {sale.priorReturns.length} devolución(es)</span>}
          </p>
        )}
        {sale ? (
          <div className="overflow-x-auto rounded-app border border-border">
            <table className="table">
              <thead><tr><th>Producto</th><th className="text-right">Puede devolver</th><th className="w-24">Devuelve</th><th className="text-center">A inventario</th></tr></thead>
              <tbody>
                {sale.lines.map((l) => (
                  <tr key={l.saleLineId} className={l.returnableQty <= 0 ? "opacity-50" : ""}>
                    <td>{l.description}<span className="block font-mono text-xs text-muted">{l.sku}</span></td>
                    <td className="text-right">{formatQty(l.returnableQty)}<span className="block text-xs text-muted">de {formatQty(l.quantity)}</span></td>
                    <td>
                      <input className={`field !min-h-9 !py-1 ${Number(qty[l.saleLineId] || 0) > l.returnableQty ? "field-error" : ""}`} inputMode="decimal" disabled={l.returnableQty <= 0} aria-label={`Devuelve de ${l.description}`} value={qty[l.saleLineId] ?? ""} placeholder="0" onChange={(e) => setQty({ ...qty, [l.saleLineId]: e.target.value.replace(/[^0-9.]/g, "") })} />
                      <button type="button" className="text-xs text-primary" disabled={l.returnableQty <= 0} onClick={() => setQty({ ...qty, [l.saleLineId]: String(l.returnableQty) })}>Todo</button>
                    </td>
                    <td className="text-center"><input type="checkbox" className="size-5 accent-primary" aria-label={`Regresa a inventario ${l.description}`} checked={restock[l.saleLineId] ?? true} onChange={(e) => setRestock({ ...restock, [l.saleLineId]: e.target.checked })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 size-5 text-muted" aria-hidden />
              <input className="field pl-10" placeholder="Buscar producto devuelto" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar producto devuelto" />
              {results.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full rounded-app border border-border bg-surface shadow-lg">
                  {results.map((it) => (
                    <li key={it.variantId}>
                      <button type="button" className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => { setNoTicketLines((x) => (x.some((y) => y.item.variantId === it.variantId) ? x : [...x, { item: it, qty: "1", restock: true }])); setSearch(""); }}>
                        <span>{it.name}{it.variantName && ` · ${it.variantName}`}</span><span>{formatCents(it.price, currency)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {noTicketLines.map((l, i) => (
              <div key={l.item.variantId} className="flex items-center gap-2 rounded-app border border-border p-2 text-sm">
                <span className="flex-1">{l.item.name}{l.item.variantName && ` · ${l.item.variantName}`}<span className="block text-xs text-muted">precio vigente {formatCents(l.item.price, currency)}</span></span>
                <input className="field !min-h-9 w-20 !py-1" inputMode="decimal" aria-label="Cantidad devuelta" value={l.qty} onChange={(e) => setNoTicketLines((x) => x.map((y, j) => (j === i ? { ...y, qty: e.target.value.replace(/[^0-9.]/g, "") } : y)))} />
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" className="accent-primary" checked={l.restock} onChange={(e) => setNoTicketLines((x) => x.map((y, j) => (j === i ? { ...y, restock: e.target.checked } : y)))} /> inventario</label>
                <button type="button" className="p-1 text-danger" aria-label="Quitar" onClick={() => setNoTicketLines((x) => x.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>
              </div>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
          <select className="field" value={reasonCode} onChange={(e) => setReasonCode(e.target.value as typeof reasonCode)} aria-label="Motivo">
            {REASONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input className="field" placeholder="Describe el motivo" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Descripción del motivo" data-testid="return-reason" />
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">¿Cómo se le regresa?</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {options.filter((o) => o.show).map((o) => (
              <button type="button" key={o.key} onClick={() => setChoice(o.key)} className={`rounded-app border px-3 py-3 text-sm font-medium ${choice === o.key ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>{o.label}</button>
            ))}
          </div>
          {choice === "exchange" && <p className="mt-2 text-xs text-muted">Se emite un vale y se aplica como pago de los productos nuevos. Si sobra, el vale conserva el saldo.</p>}
          {choice === "original" && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <select className="field" value={originalMethod} onChange={(e) => setOriginalMethod(e.target.value)} aria-label="Medio de pago original">
                {electronic.map((p) => <option key={p.methodId} value={p.methodId}>{p.name} · {formatCents(p.amount, currency)}</option>)}
              </select>
              <input className="field" placeholder="Folio de la reversa en la terminal" value={reference} onChange={(e) => setReference(e.target.value)} aria-label="Referencia del reembolso" />
            </div>
          )}
        </div>
        {needsAuth && (
          <div className="space-y-2 rounded-app border border-warning/50 bg-warning/10 p-3">
            <p className="text-sm font-medium">Requiere autorización de un gerente</p>
            <input className="field" placeholder="Usuario del gerente" value={authUser} onChange={(e) => setAuthUser(e.target.value)} autoComplete="off" aria-label="Usuario autorizador" />
            <input className="field" type="password" placeholder="Contraseña" value={authPass} onChange={(e) => setAuthPass(e.target.value)} autoComplete="off" aria-label="Contraseña del autorizador" />
          </div>
        )}
        {error && <p className="rounded-app bg-danger-bg p-3 text-sm text-danger" role="alert">{error}</p>}
        <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 p-3">
          <span className="text-sm text-muted">{choice === "cash" ? "Se entrega en efectivo" : choice === "exchange" || choice === "store_credit" ? "Valor del vale" : "A reembolsar"}</span>
          <span className="text-2xl font-bold" data-testid="return-total">{formatCents(total, currency)}</span>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <button type="button" className="rounded-xl border border-border px-4 py-3" onClick={() => { setStep("find"); setError(null); }}>Atrás</button>
          <button className="rounded-xl bg-primary py-3 text-lg font-semibold text-primary-fg disabled:opacity-50" disabled={invalid || busy} data-testid="confirm-return">
            {busy ? "Registrando…" : choice === "exchange" ? "Registrar y elegir productos nuevos" : "Registrar devolución"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
