"use client";

import { useEffect, useRef, useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { formatCents, parseMoney } from "@/lib/money";
import { uuidv7 } from "@/lib/pos/local-db";
import { CLIENT_HEADERS } from "@/lib/pos/sync";
import type { PosCatalog } from "@/server/modules/pos/catalog";
import { Modal } from "./pos-parts";

/** Cliente tal como lo entrega la API (ver `PosCustomer` en el servicio). */
export type PosCustomer = {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  taxId: string | null;
  credit: { limit: number; balance: number; available: number; overdue: number; blocked: boolean; days: number } | null;
  balance: number;
};

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string; code?: string }> {
  try {
    const res = await fetch(url, { credentials: "same-origin", ...init });
    return await res.json();
  } catch {
    return { ok: false, error: "Sin conexión con el servidor." };
  }
}

/** Buscador de clientes con alta rápida. Sin conexión solo permite escribir el nombre para el ticket. */
export function CustomerModal({ online, canCreate, onPick, onName, onClose }: { online: boolean; canCreate: boolean; onPick: (c: PosCustomer) => void; onName: (name: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PosCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "" });
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!online || creating) return;
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setLoading(true);
      const r = await api<PosCustomer[]>(`/api/v1/customers?q=${encodeURIComponent(q.trim())}`);
      setLoading(false);
      if (r.ok) {
        setResults(r.data);
        setError(null);
      } else setError(r.error);
    }, 250);
  }, [q, online, creating]);

  async function create(allowDuplicate = false) {
    setError(null);
    setLoading(true);
    const r = await api<PosCustomer>("/api/v1/customers", { method: "POST", headers: CLIENT_HEADERS, body: JSON.stringify({ ...form, allowDuplicate }) });
    setLoading(false);
    if (r.ok) onPick(r.data);
    else if (r.code === "duplicate_customer") setDupWarning(r.error);
    else setError(r.error);
  }

  if (!online) {
    return (
      <Modal title="Cliente" onClose={onClose}>
        <p className="mb-3 text-sm text-warning">Sin conexión no se pueden buscar clientes. Puedes escribir el nombre para el ticket.</p>
        <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) onName(q.trim()); }} className="space-y-3">
          <input autoFocus className="field" placeholder="Nombre del cliente" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Nombre del cliente" />
          <button className="w-full rounded-xl bg-primary py-3 font-semibold text-primary-fg disabled:opacity-50" disabled={!q.trim()}>Usar este nombre</button>
        </form>
      </Modal>
    );
  }

  if (creating) {
    return (
      <Modal title="Nuevo cliente" onClose={onClose}>
        <form onSubmit={(e) => { e.preventDefault(); create(); }} className="space-y-3">
          <label className="block text-sm font-medium">Nombre *<input autoFocus className="field mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="block text-sm font-medium">Teléfono (10 dígitos)<input className="field mt-1" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label className="block text-sm font-medium">Correo<input className="field mt-1" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          {error && <p className="rounded-app bg-danger-bg p-2 text-sm text-danger" role="alert">{error}</p>}
          {dupWarning && (
            <div className="rounded-app border border-warning/50 bg-warning/10 p-3 text-sm">
              <p>{dupWarning}</p>
              <div className="mt-2 flex gap-2">
                <button type="button" className="rounded-app border border-border px-3 py-2" onClick={() => { setCreating(false); setQ(form.phone || form.email || form.name); setDupWarning(null); }}>Buscarlo</button>
                <button type="button" className="rounded-app bg-warning px-3 py-2 font-medium text-white" onClick={() => create(true)}>Crear de todos modos</button>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" className="flex-1 rounded-xl border border-border py-3" onClick={() => setCreating(false)}>Volver</button>
            <button className="flex-1 rounded-xl bg-primary py-3 font-semibold text-primary-fg disabled:opacity-50" disabled={loading || form.name.trim().length < 2}>{loading ? "Guardando…" : "Crear y usar"}</button>
          </div>
        </form>
      </Modal>
    );
  }

  return (
    <Modal title="Cliente de la venta" onClose={onClose} wide>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-3 size-5 text-muted" aria-hidden />
        <input autoFocus className="field pl-10" placeholder="Nombre, teléfono, correo o RFC" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar cliente" />
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <ul className="mt-3 max-h-80 divide-y divide-border overflow-auto" data-testid="customer-results">
        {loading && <li className="py-2 text-sm text-muted">Buscando…</li>}
        {!loading && q.trim().length >= 2 && results.length === 0 && <li className="py-2 text-sm text-muted">Sin coincidencias.</li>}
        {results.map((c) => (
          <li key={c.id}>
            <button className="flex w-full items-center justify-between gap-2 px-2 py-3 text-left hover:bg-surface-2" onClick={() => onPick(c)}>
              <span>
                <span className="block font-medium">{c.name}</span>
                <span className="block text-xs text-muted">{[c.code, c.phone, c.email].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="text-right text-xs">
                {c.credit ? (
                  <span className={c.credit.overdue > 0 || c.credit.blocked ? "text-danger" : "text-success"}>
                    {c.credit.blocked ? "Crédito bloqueado" : `Disponible ${formatCents(c.credit.available)}`}
                    {c.credit.overdue > 0 && <span className="block">Vencido {formatCents(c.credit.overdue)}</span>}
                  </span>
                ) : c.balance > 0 ? <span className="text-warning">Saldo {formatCents(c.balance)}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {canCreate && (
        <button className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3 text-sm font-medium" onClick={() => { setCreating(true); setForm({ name: /\d/.test(q) ? "" : q, phone: /^\d[\d\s]*$/.test(q.trim()) ? q.trim() : "", email: q.includes("@") ? q.trim() : "" }); }}>
          <UserPlus className="size-4" /> Nuevo cliente
        </button>
      )}
    </Modal>
  );
}

export type AbonoResult = { id: string; folio: string; amount: number; balanceAfter: number; createdAt: string; methodName: string; received: number | null; change: number; customer: PosCustomer };

/** Abono a la cuenta de un cliente, cobrado en esta caja (entra al corte). */
export function AbonoModal({
  registerId,
  methods,
  currency,
  initialCustomer,
  canCreate,
  onDone,
  onClose,
}: {
  registerId: string;
  methods: PosCatalog["paymentMethods"];
  currency: string;
  initialCustomer: PosCustomer | null;
  canCreate: boolean;
  onDone: (r: AbonoResult) => void;
  onClose: () => void;
}) {
  const usable = methods.filter((m) => m.kind !== "customer_credit");
  const [customer, setCustomer] = useState<PosCustomer | null>(initialCustomer && initialCustomer.balance > 0 ? initialCustomer : null);
  const [picking, setPicking] = useState(!customer);
  const [methodId, setMethodId] = useState(usable.find((m) => m.kind === "cash")?.id ?? usable[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [received, setReceived] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef<string>(uuidv7());
  const method = usable.find((m) => m.id === methodId);
  const isCash = method?.kind === "cash";
  const cents = parseMoney(amount);
  const receivedCents = received ? parseMoney(received) : cents;
  const change = isCash && cents !== null && receivedCents !== null ? receivedCents - cents : 0;
  const invalid = !customer || !method || cents === null || cents <= 0 || cents > (customer?.balance ?? 0) || (isCash && (receivedCents === null || receivedCents < cents)) || (method.requiresReference && !reference.trim());

  if (picking) return <CustomerModal online canCreate={canCreate} onPick={(c) => { setCustomer(c); setPicking(false); setAmount(""); }} onName={() => {}} onClose={customer ? () => setPicking(false) : onClose} />;

  async function submit() {
    if (invalid || busy || !customer || cents === null) return;
    setBusy(true);
    setError(null);
    const r = await api<{ id: string; folio: string; amount: number; balanceAfter: number; createdAt: string; customer: PosCustomer }>("/api/v1/customers/payments", {
      method: "POST",
      headers: CLIENT_HEADERS,
      body: JSON.stringify({ id: idRef.current, customerId: customer.id, amount: (cents / 100).toFixed(2), paymentMethodId: methodId, reference: reference.trim() || undefined, cashRegisterId: registerId }),
    });
    setBusy(false);
    if (r.ok) onDone({ ...r.data, methodName: method!.name, received: isCash ? receivedCents : null, change: isCash ? change : 0 });
    else setError(r.error);
  }

  return (
    <Modal title="Abono de cliente" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4">
        <div className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 p-3">
          <div>
            <p className="font-medium">{customer!.name}</p>
            <p className="text-sm text-muted">Saldo <b data-testid="abono-balance">{formatCents(customer!.balance, currency)}</b>{customer!.credit && customer!.credit.overdue > 0 && <span className="text-danger"> · vencido {formatCents(customer!.credit.overdue, currency)}</span>}</p>
          </div>
          <button type="button" className="text-sm text-primary underline" onClick={() => setPicking(true)}>Cambiar</button>
        </div>
        {customer!.balance <= 0 ? (
          <p className="text-sm text-muted">Este cliente no tiene saldo pendiente.</p>
        ) : (
          <>
            <label className="block text-sm font-medium">Importe del abono
              <input autoFocus className="field mt-1 text-2xl" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" data-testid="abono-amount" />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded-app border border-border px-3 py-2 text-sm" onClick={() => setAmount((customer!.balance / 100).toFixed(2))}>Liquidar {formatCents(customer!.balance, currency)}</button>
              {customer!.credit && customer!.credit.overdue > 0 && customer!.credit.overdue < customer!.balance && (
                <button type="button" className="rounded-app border border-border px-3 py-2 text-sm" onClick={() => setAmount((customer!.credit!.overdue / 100).toFixed(2))}>Lo vencido {formatCents(customer!.credit.overdue, currency)}</button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {usable.map((m) => (
                <button type="button" key={m.id} onClick={() => setMethodId(m.id)} className={`rounded-app border px-3 py-3 text-sm font-medium ${methodId === m.id ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>{m.name}</button>
              ))}
            </div>
            {isCash ? (
              <label className="block text-sm font-medium">Efectivo recibido
                <input className="field mt-1" inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} placeholder={amount || "0.00"} />
                {change > 0 && <span className="mt-1 block text-success">Cambio {formatCents(change, currency)}</span>}
              </label>
            ) : (
              method?.requiresReference && (
                <label className="block text-sm font-medium">Referencia
                  <input className="field mt-1" value={reference} onChange={(e) => setReference(e.target.value)} />
                </label>
              )
            )}
            {cents !== null && cents > customer!.balance && <p className="text-sm text-danger">El abono no puede ser mayor al saldo.</p>}
          </>
        )}
        {error && <p className="rounded-app bg-danger-bg p-3 text-sm text-danger" role="alert">{error}</p>}
        <button type="submit" disabled={invalid || busy} className="w-full rounded-xl bg-primary py-4 text-lg font-semibold text-primary-fg disabled:opacity-50" data-testid="confirm-abono">
          {busy ? "Registrando…" : "Registrar abono"}
        </button>
      </form>
    </Modal>
  );
}
