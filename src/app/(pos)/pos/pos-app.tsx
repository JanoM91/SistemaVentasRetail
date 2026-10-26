"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CloudOff, Pause, Printer, RefreshCw, Search, Star, Wifi } from "lucide-react";
import { computeTotals, formatCents, normalizeQty } from "@/lib/money";
import { localDb, nextClientSequence, uuidv7, type HeldCart, type RecentSale } from "@/lib/pos/local-db";
import { CLIENT_HEADERS, outboxCounts, syncOutbox } from "@/lib/pos/sync";
import { Ticket, type TicketData } from "@/components/pos/ticket";
import type { PosCatalog, PosItem } from "@/server/modules/pos/catalog";
import { CartView, DiscountModal, groupProducts, lineAmounts, Modal, norm, PaymentModal, ProductGrid, VariantModal, type CartLine, type PaymentChoice, type ProductTile } from "./pos-parts";

export type PosRegister = { id: string; code: string; name: string; session: { id: string; openedAt: string; openedByName: string | null } | null };

export type PosInitial = {
  tenantId: string;
  user: { id: string; fullName: string };
  company: { tradeName: string; legalName: string; taxId: string | null; address: Record<string, string | undefined>; currency: string; timezone: string; maxDiscountPercent: number };
  branch: { id: string; name: string };
  registers: PosRegister[];
  can: { discount: boolean; editPrice: boolean; openCash: boolean };
  loadedAt: string;
};

type Toast = { tone: "info" | "success" | "warning" | "danger"; text: string };
const REG_KEY = "sc_pos_register";

export function PosApp({ initial }: { initial: PosInitial }) {
  const cur = initial.company.currency;
  const [online, setOnline] = useState(true);
  const [catalog, setCatalog] = useState<PosCatalog | null>(null);
  const [catalogSource, setCatalogSource] = useState<"network" | "local" | null>(null);
  const [registers, setRegisters] = useState(initial.registers);
  const [registerId, setRegisterId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountAuth, setDiscountAuth] = useState<{ username: string; password: string } | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"fav" | "all" | string>("fav");
  const [variantTile, setVariantTile] = useState<ProductTile | null>(null);
  const [discountLine, setDiscountLine] = useState<number | null>(null);
  const [paying, setPaying] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [panel, setPanel] = useState<"held" | "pending" | null>(null);
  const [held, setHeld] = useState<HeldCart[]>([]);
  const [recent, setRecent] = useState<RecentSale[]>([]);
  const [counts, setCounts] = useState({ pending: 0, rejected: 0, otherUsers: 0 });
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /** UUID de la venta en cobro: se conserva entre reintentos para que el servidor no la duplique. */
  const saleIdRef = useRef<string | null>(null);

  const notify = useCallback((t: Toast) => {
    setToast(t);
    setTimeout(() => setToast((cur) => (cur === t ? null : cur)), 4500);
  }, []);
  const focusSearch = useCallback(() => setTimeout(() => searchRef.current?.focus(), 0), []);

  // ------------------------------------------------------------ Conexión, catálogo, caja

  const refreshCounts = useCallback(async () => {
    setCounts(await outboxCounts(initial.user.id));
    setRecent((await localDb.recentAll()).sort((a, b) => b.soldAt.localeCompare(a.soldAt)));
    setHeld(await localDb.heldAll());
  }, [initial.user.id]);

  const loadCatalog = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/pos/catalog?branchId=${initial.branch.id}`, { credentials: "same-origin" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      await localDb.saveCatalog(json.data);
      setCatalog(json.data);
      setCatalogSource("network");
      return json.data as PosCatalog;
    } catch {
      const local = await localDb.getCatalog(initial.branch.id);
      if (local) {
        setCatalog(local);
        setCatalogSource("local");
      }
      return local ?? null;
    }
  }, [initial.branch.id]);

  const refreshRegisters = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/pos/registers?branchId=${initial.branch.id}`, { credentials: "same-origin" });
      const json = await res.json();
      if (json.ok) {
        setRegisters(json.data);
        await localDb.setKv(`registers:${initial.branch.id}`, json.data);
      }
    } catch {
      /* sin conexión: se usa lo último conocido */
    }
  }, [initial.branch.id]);

  const runSync = useCallback(async (silent = false) => {
    if (!navigator.onLine) return;
    setSyncing(true);
    const r = await syncOutbox(initial.user.id);
    setSyncing(false);
    await refreshCounts();
    if (r.unauthenticated) notify({ tone: "warning", text: r.error! });
    else if (!silent && r.sent === 0 && !r.error) notify({ tone: "info", text: "No hay ventas pendientes." });
    else if (r.sent > 0) {
      const parts = [`${r.applied + r.conflicts} sincronizada(s)`];
      if (r.conflicts) parts.push(`${r.conflicts} con observaciones`);
      if (r.rejected) parts.push(`${r.rejected} rechazada(s)`);
      notify({ tone: r.rejected ? "danger" : r.conflicts ? "warning" : "success", text: parts.join(" · ") });
    }
  }, [initial.user.id, notify, refreshCounts]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const saved = (() => {
      try {
        return localStorage.getItem(REG_KEY);
      } catch {
        return null;
      }
    })();
    const fallback = initial.registers.find((r) => r.session) ?? initial.registers[0];
    setRegisterId(initial.registers.some((r) => r.id === saved) ? saved : (fallback?.id ?? null));
    (async () => {
      const loadedFromServer = Date.now() - new Date(initial.loadedAt).getTime() < 60_000;
      if (!loadedFromServer) {
        // Página servida desde caché (sin red): usa el último estado de cajas guardado.
        const cached = await localDb.getKv<PosRegister[]>(`registers:${initial.branch.id}`);
        if (cached) setRegisters(cached);
      } else await localDb.setKv(`registers:${initial.branch.id}`, initial.registers);
      await loadCatalog();
      await refreshCounts();
      runSync(true);
    })();
    const on = () => {
      setOnline(true);
      refreshRegisters();
      loadCatalog();
      runSync(true);
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const timer = setInterval(() => navigator.onLine && runSync(true), 30_000);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then(() => navigator.serviceWorker.ready)
        .then((reg) => {
          const urls = ["/pos", ...performance.getEntriesByType("resource").map((e) => e.name)];
          reg.active?.postMessage({ type: "precache", urls });
        })
        .catch(() => {});
    }
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (registerId)
      try {
        localStorage.setItem(REG_KEY, registerId);
      } catch {}
  }, [registerId]);

  const register = registers.find((r) => r.id === registerId) ?? null;
  const sessionOpen = !!register?.session;

  // ------------------------------------------------------------ Búsqueda

  const items = useMemo(() => catalog?.items ?? [], [catalog]);
  const tiles = useMemo(() => {
    let list = items;
    const q = norm(query.trim());
    if (q) {
      const terms = q.split(/\s+/);
      list = items.filter((it) => {
        const hay = norm(`${it.name} ${it.variantName} ${it.sku} ${it.barcodes.join(" ")}`);
        return terms.every((t) => hay.includes(t));
      });
    } else if (filter === "fav") list = items.filter((it) => it.isFavorite);
    else if (filter !== "all") list = items.filter((it) => it.categoryId === filter);
    return groupProducts(list).slice(0, 120);
  }, [items, query, filter]);

  // ------------------------------------------------------------ Carrito

  const addItem = useCallback(
    (it: PosItem, qty = 1) => {
      setCart((c) => {
        const i = c.findIndex((l) => l.variantId === it.variantId);
        if (i >= 0) return c.map((l, j) => (j === i ? { ...l, quantity: normalizeQty(l.quantity + qty) } : l));
        return [
          ...c,
          {
            variantId: it.variantId,
            productId: it.productId,
            name: it.name,
            variantName: it.variantName,
            sku: it.sku,
            quantity: qty,
            unitPrice: it.price,
            discount: 0,
            taxRate: it.taxRate,
            taxIncluded: it.taxIncluded,
            allowsDecimals: it.allowsDecimals,
            stock: it.stock,
          },
        ];
      });
      if (it.stock !== null && it.stock <= 0) notify({ tone: "warning", text: `${it.name}: sin existencia registrada.` });
    },
    [notify],
  );

  const pickTile = (t: ProductTile) => {
    if (t.variants.length === 1) addItem(t.variants[0]);
    else setVariantTile(t);
    setQuery("");
    focusSearch();
  };

  const onSearchEnter = () => {
    const q = query.trim();
    if (!q) return;
    const lower = q.toLowerCase();
    const exact = items.find((it) => it.barcodes.includes(q) || it.sku.toLowerCase() === lower);
    if (exact) {
      addItem(exact);
      setQuery("");
      return;
    }
    if (tiles.length === 1) return pickTile(tiles[0]);
    if (tiles.length === 0) notify({ tone: "danger", text: `No se encontró «${q}».` });
  };

  const setQty = (i: number, q: number) => {
    setCart((c) => {
      const l = c[i];
      if (!l) return c;
      let qty = normalizeQty(q);
      if (!l.allowsDecimals) qty = Math.round(qty);
      if (qty <= 0) return c.filter((_, j) => j !== i);
      return c.map((x, j) => (j === i ? { ...x, quantity: qty, discount: Math.min(x.discount, lineAmounts({ ...x, quantity: qty, discount: 0 }).gross) } : x));
    });
  };

  useEffect(() => {
    // Si cambia el contenido, es otra venta.
    saleIdRef.current = null;
  }, [cart]);

  const totals = useMemo(() => computeTotals(cart.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity, discount: l.discount, taxRate: l.taxRate, taxIncluded: l.taxIncluded }))), [cart]);

  const clearSale = () => {
    setCart([]);
    setDiscountAuth(null);
    setQuery("");
    focusSearch();
  };

  // ------------------------------------------------------------ Suspender / recuperar

  const holdSale = async () => {
    if (!cart.length || !registerId) return;
    await localDb.heldPut({ id: uuidv7(), label: `${cart.length} producto(s) · ${formatCents(totals.total, cur)}`, createdAt: new Date().toISOString(), registerId, lines: cart });
    clearSale();
    await refreshCounts();
    notify({ tone: "info", text: "Venta en espera. Recupérala desde «En espera»." });
  };

  const resumeSale = async (h: HeldCart) => {
    if (cart.length && !confirm("Hay una venta en curso. ¿Reemplazarla?")) return;
    setCart(h.lines as CartLine[]);
    await localDb.heldDelete(h.id);
    setPanel(null);
    await refreshCounts();
    focusSearch();
  };

  // ------------------------------------------------------------ Cobro

  const buildTicket = (folio: string | null, payment: { name: string; amount: number; received: number | null; change: number; reference: string | null }, soldAt: string, pending: boolean): TicketData => ({
    company: { tradeName: initial.company.tradeName, legalName: initial.company.legalName, taxId: initial.company.taxId, address: initial.company.address },
    branch: { name: initial.branch.name },
    folio,
    soldAt,
    timezone: initial.company.timezone,
    sellerName: initial.user.fullName,
    registerName: register?.name ?? "",
    currency: cur,
    status: pending ? "pending" : "completed",
    lines: cart.map((l) => {
      const a = lineAmounts(l);
      return { description: `${l.name}${l.variantName ? ` ${l.variantName}` : ""}`, sku: l.sku, quantity: l.quantity, unitPrice: l.unitPrice, discount: a.discount, total: a.total };
    }),
    totals: { subtotal: totals.subtotal, tax: totals.tax, discount: totals.discount, total: totals.total },
    payments: [payment],
    offline: pending,
  });

  const decrementLocalStock = async () => {
    if (!catalog) return;
    const byId = new Map(cart.map((l) => [l.variantId, l.quantity]));
    const next = { ...catalog, items: catalog.items.map((it) => (it.stock !== null && byId.has(it.variantId) ? { ...it, stock: normalizeQty(it.stock - byId.get(it.variantId)!) } : it)) };
    setCatalog(next);
    await localDb.saveCatalog(next);
  };

  const confirmSale = async (p: PaymentChoice) => {
    if (!register || !catalog) return;
    const method = catalog.paymentMethods.find((m) => m.id === p.methodId)!;
    setPayBusy(true);
    setPayError(null);
    const { deviceId, sequence } = await nextClientSequence();
    const id = (saleIdRef.current ??= uuidv7());
    const soldAt = new Date().toISOString();
    const isCash = method.kind === "cash" || method.allowsChange;
    const payload = {
      id,
      cashRegisterId: register.id,
      soldAt,
      clientSequence: sequence,
      deviceId,
      lines: cart.map((l) => ({ variantId: l.variantId, quantity: l.quantity, unitPrice: l.unitPrice, discount: lineAmounts(l).discount })),
      payments: [{ paymentMethodId: method.id, amount: totals.total, received: isCash ? (p.received ?? totals.total) : undefined, reference: p.reference || undefined }],
      ...(discountAuth ? { discountAuthorization: discountAuth } : {}),
    };
    const paymentInfo = { name: method.name, amount: totals.total, received: isCash ? (p.received ?? totals.total) : null, change: isCash ? (p.received ?? totals.total) - totals.total : 0, reference: p.reference || null };

    const queueOffline = async () => {
      if (method.kind !== "cash") {
        setPayError("Sin conexión solo se aceptan pagos en efectivo.");
        return false;
      }
      const { discountAuthorization: _omit, ...offlinePayload } = payload as typeof payload & { discountAuthorization?: unknown };
      void _omit;
      const t = buildTicket(null, paymentInfo, soldAt, true);
      await localDb.outboxPut({ id, userId: initial.user.id, tenantId: initial.tenantId, createdAt: soldAt, attempts: 0, status: "pending", payload: offlinePayload, ticket: t });
      await localDb.recentPut({ id, folio: null, total: totals.total, soldAt, status: "pending", ticket: t });
      await decrementLocalStock();
      setTicket(t);
      return true;
    };

    try {
      if (!navigator.onLine) {
        if (await queueOffline()) finishSale();
        return;
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      let res: Response;
      try {
        res = await fetch("/api/v1/pos/sales", { method: "POST", headers: CLIENT_HEADERS, body: JSON.stringify(payload), signal: ctrl.signal, credentials: "same-origin" });
      } catch {
        // La red falló (o tardó): se guarda localmente. Si el servidor sí la recibió, la sincronización la reconoce como duplicada.
        clearTimeout(timer);
        if (await queueOffline()) finishSale();
        return;
      }
      clearTimeout(timer);
      const json = await res.json().catch(() => ({ ok: false, error: "Respuesta inválida del servidor." }));
      if (!json.ok) {
        if (res.status >= 500) {
          if (await queueOffline()) finishSale();
          return;
        }
        setPayError(json.error ?? "No se pudo registrar la venta.");
        if (json.code === "price_changed") {
          const fresh = await loadCatalog();
          if (fresh) setCart((c) => c.map((l) => ({ ...l, unitPrice: fresh.items.find((it) => it.variantId === l.variantId)?.price ?? l.unitPrice })));
          setPayError("Los precios se actualizaron. Revisa el total y cobra de nuevo.");
        }
        if (json.code === "unauthenticated") setPayError("Tu sesión expiró. Inicia sesión en otra pestaña y vuelve a cobrar.");
        return;
      }
      const t = buildTicket(json.data.folio, paymentInfo, soldAt, false);
      await localDb.recentPut({ id, folio: json.data.folio, total: totals.total, soldAt, status: "synced", ticket: t });
      await decrementLocalStock();
      setTicket(t);
      finishSale();
    } finally {
      setPayBusy(false);
      refreshCounts();
    }
  };

  const finishSale = () => {
    saleIdRef.current = null;
    setPaying(false);
    setCart([]);
    setDiscountAuth(null);
    localDb.recentTrim(50);
    if (navigator.onLine) runSync(true);
  };

  const printTicket = () => {
    document.body.classList.add("printing-ticket");
    window.print();
    setTimeout(() => document.body.classList.remove("printing-ticket"), 500);
  };

  // ------------------------------------------------------------ Atajos de teclado

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        focusSearch();
      } else if ((e.key === "F4" || e.key === "F12") && cart.length && sessionOpen && !paying) {
        e.preventDefault();
        setPayError(null);
        setPaying(true);
      } else if (e.key === "F8" && cart.length) {
        e.preventDefault();
        holdSale();
      } else if (ticket && (e.key === "Enter" || e.key === "Escape")) {
        e.preventDefault();
        setTicket(null);
        focusSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ------------------------------------------------------------ Render

  const catalogAge = catalog ? Math.round((Date.now() - new Date(catalog.generatedAt).getTime()) / 60000) : null;

  return (
    <div className="flex h-full flex-col">
      {/* Barra superior */}
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <Link href="/" className="rounded-app p-2 hover:bg-surface-2" aria-label="Salir del punto de venta"><ArrowLeft className="size-5" /></Link>
        <div className="mr-auto min-w-0">
          <p className="truncate text-sm font-semibold">{initial.branch.name}</p>
          <p className="truncate text-xs text-muted">{initial.user.fullName}</p>
        </div>
        <select className="field !min-h-9 w-auto !py-1 text-sm" value={registerId ?? ""} onChange={(e) => setRegisterId(e.target.value)} aria-label="Caja">
          {registers.map((r) => <option key={r.id} value={r.id}>{r.name}{r.session ? "" : " (cerrada)"}</option>)}
        </select>
        <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${online ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`} data-testid="net-status">
          {online ? <Wifi className="size-3.5" /> : <CloudOff className="size-3.5" />} {online ? "En línea" : "Sin conexión"}
        </span>
        <button onClick={() => setPanel("pending")} className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${counts.pending || counts.rejected ? "bg-warning/15 text-warning" : "bg-surface-2 text-muted"}`} data-testid="pending-badge">
          <RefreshCw className={`size-3.5 ${syncing ? "animate-spin" : ""}`} /> {counts.pending} pendiente{counts.pending === 1 ? "" : "s"}{counts.rejected ? ` · ${counts.rejected} rechazada(s)` : ""}
        </button>
        <button onClick={() => setPanel("held")} className="flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted">
          <Pause className="size-3.5" /> En espera ({held.length})
        </button>
      </header>

      {!catalog && (
        <div className="m-4 rounded-app border border-warning/50 bg-warning/10 p-4 text-sm">
          {online ? "Cargando catálogo…" : "Sin conexión y sin catálogo guardado en este dispositivo. Abre el punto de venta con internet al menos una vez."}
        </div>
      )}

      {catalog && !sessionOpen && (
        <div className="m-3 flex flex-wrap items-center gap-3 rounded-app border border-warning/50 bg-warning/10 p-3 text-sm">
          <span className="flex-1">{register ? `${register.name} no tiene un turno abierto.` : "Esta sucursal no tiene cajas."} Abre la caja para poder vender.</span>
          {initial.can.openCash && online && <Link className="rounded-app bg-primary px-4 py-2 font-medium text-primary-fg" href="/caja">Abrir caja</Link>}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_400px]">
        {/* Productos */}
        <section className="flex min-h-0 flex-col">
          <div className="space-y-2 border-b border-border p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3.5 size-5 text-muted" aria-hidden />
              <input
                ref={searchRef}
                autoFocus
                className="field !min-h-12 pl-10 text-lg"
                placeholder="Buscar o escanear (F2)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onSearchEnter();
                  } else if (e.key === "Escape") setQuery("");
                }}
                aria-label="Buscar producto o escanear código"
                data-testid="pos-search"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              <Chip active={filter === "fav" && !query} onClick={() => { setFilter("fav"); setQuery(""); }}><Star className="size-3.5" /> Favoritos</Chip>
              <Chip active={filter === "all" && !query} onClick={() => { setFilter("all"); setQuery(""); }}>Todos</Chip>
              {catalog?.categories.map((c) => (
                <Chip key={c.id} active={filter === c.id && !query} onClick={() => { setFilter(c.id); setQuery(""); }}>{c.name}</Chip>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {filter === "fav" && !query && tiles.length === 0 && items.length > 0 ? (
              <p className="p-6 text-center text-sm text-muted">No hay favoritos. Márcalos en el catálogo o elige «Todos».</p>
            ) : (
              <ProductGrid tiles={tiles} currency={cur} onPick={pickTile} />
            )}
          </div>
          <p className="border-t border-border px-3 py-1 text-xs text-muted">
            Catálogo {catalogSource === "local" ? "guardado en el dispositivo" : "actualizado"}{catalogAge !== null && ` · hace ${catalogAge} min`} · {items.length} artículos · F2 buscar · F4 cobrar · F8 en espera
          </p>
        </section>

        {/* Carrito */}
        <aside className="flex min-h-0 flex-col border-t border-border bg-surface lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h2 className="font-semibold">Venta actual</h2>
            {cart.length > 0 && <button className="text-sm text-danger" onClick={() => confirm("¿Vaciar la venta?") && clearSale()}>Vaciar</button>}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <CartView lines={cart} currency={cur} onQty={setQty} onRemove={(i) => setCart((c) => c.filter((_, j) => j !== i))} onDiscount={(i) => setDiscountLine(i)} />
          </div>
          <div className="space-y-1 border-t border-border p-3 text-sm">
            <Row label="Subtotal" value={formatCents(totals.subtotal, cur)} />
            <Row label="Impuestos" value={formatCents(totals.tax, cur)} />
            {totals.discount > 0 && <Row label="Descuentos" value={`−${formatCents(totals.discount, cur)}`} />}
            <div className="flex items-baseline justify-between pt-1">
              <span className="text-base font-semibold">Total</span>
              <span className="text-3xl font-bold" data-testid="cart-total">{formatCents(totals.total, cur)}</span>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-2 pt-2">
              <button className="rounded-xl border border-border px-4 py-4 font-medium disabled:opacity-40" disabled={!cart.length} onClick={holdSale} title="Poner en espera (F8)"><Pause className="size-5" /></button>
              <button
                className="rounded-xl bg-primary py-4 text-lg font-semibold text-primary-fg disabled:opacity-40"
                disabled={!cart.length || !sessionOpen || !catalog}
                onClick={() => { setPayError(null); setPaying(true); }}
                data-testid="charge"
              >
                Cobrar {cart.length > 0 && formatCents(totals.total, cur)}
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* Modales */}
      {variantTile && <VariantModal tile={variantTile} currency={cur} onPick={(v) => { addItem(v); setVariantTile(null); focusSearch(); }} onClose={() => { setVariantTile(null); focusSearch(); }} />}
      {discountLine !== null && cart[discountLine] && (
        <DiscountModal
          line={cart[discountLine]}
          currency={cur}
          maxPct={initial.company.maxDiscountPercent}
          needsAuth={!initial.can.discount}
          online={online}
          onClose={() => setDiscountLine(null)}
          onApply={(d, auth) => {
            setCart((c) => c.map((l, j) => (j === discountLine ? { ...l, discount: d } : l)));
            if (auth) setDiscountAuth(auth);
            setDiscountLine(null);
            focusSearch();
          }}
        />
      )}
      {paying && catalog && (
        <PaymentModal total={totals.total} currency={cur} methods={catalog.paymentMethods} online={online} busy={payBusy} error={payError} onConfirm={confirmSale} onClose={() => { setPaying(false); focusSearch(); }} />
      )}
      {ticket && (
        <Modal title={ticket.folio ? `Venta ${ticket.folio}` : "Venta guardada sin conexión"} onClose={() => { setTicket(null); focusSearch(); }}>
          <div className="print-area rounded-app border border-border bg-white">
            <Ticket t={ticket} />
          </div>
          {!ticket.folio && <p className="mt-2 text-sm text-warning">Se sincronizará automáticamente al volver la conexión. El folio se asigna entonces.</p>}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button className="flex items-center justify-center gap-2 rounded-xl border border-border py-3 font-medium" onClick={printTicket}><Printer className="size-5" /> Imprimir</button>
            <button className="rounded-xl bg-primary py-3 font-semibold text-primary-fg" onClick={() => { setTicket(null); focusSearch(); }} data-testid="new-sale" autoFocus>Nueva venta (Enter)</button>
          </div>
        </Modal>
      )}
      {panel === "held" && (
        <Modal title="Ventas en espera" onClose={() => setPanel(null)}>
          {held.length === 0 ? <p className="text-sm text-muted">No hay ventas en espera.</p> : (
            <ul className="space-y-2">
              {held.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 rounded-app border border-border p-3">
                  <span className="text-sm">{h.label}<span className="block text-xs text-muted">{new Date(h.createdAt).toLocaleTimeString("es-MX")}</span></span>
                  <span className="flex gap-2">
                    <button className="rounded-app px-3 py-2 text-sm text-danger" onClick={async () => { await localDb.heldDelete(h.id); refreshCounts(); }}>Descartar</button>
                    <button className="rounded-app bg-primary px-3 py-2 text-sm font-medium text-primary-fg" onClick={() => resumeSale(h)}>Recuperar</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
      {panel === "pending" && (
        <Modal title="Sincronización" onClose={() => setPanel(null)} wide>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="flex-1">{counts.pending} pendiente(s) · {counts.rejected} rechazada(s){counts.otherUsers ? ` · ${counts.otherUsers} de otro usuario (se sincronizan cuando ese usuario entre)` : ""}</span>
            <button className="rounded-app bg-primary px-3 py-2 font-medium text-primary-fg disabled:opacity-50" disabled={!online || syncing} onClick={() => runSync(false)} data-testid="sync-now">{syncing ? "Sincronizando…" : "Sincronizar ahora"}</button>
          </div>
          <ul className="divide-y divide-border text-sm">
            {recent.length === 0 && <li className="py-2 text-muted">Sin ventas recientes en este dispositivo.</li>}
            {recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-mono">{r.folio ?? "Sin folio"}</span> · {formatCents(r.total, cur)}
                  <span className="block text-xs text-muted">{new Date(r.soldAt).toLocaleString("es-MX")}{r.message && ` · ${r.message}`}</span>
                </span>
                <span className="flex items-center gap-2">
                  <StatusPill status={r.status} />
                  {r.status === "rejected" && (
                    <button
                      className="text-xs text-primary underline"
                      onClick={async () => {
                        const o = (await localDb.outboxAll()).find((x) => x.id === r.id);
                        if (o) await localDb.outboxPut({ ...o, status: "pending" });
                        await localDb.recentPut({ ...r, status: "pending", message: null });
                        await refreshCounts();
                        runSync(false);
                      }}
                    >
                      Reintentar
                    </button>
                  )}
                  <button className="text-xs text-primary underline" onClick={() => { setTicket(r.ticket as TicketData); setPanel(null); }}>Ticket</button>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">Las ventas rechazadas no se borran: quedan aquí y en el registro de sincronización del servidor para que un gerente las revise.</p>
        </Modal>
      )}
      {toast && (
        <div className={`fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${{ info: "bg-text text-bg", success: "bg-success text-white", warning: "bg-warning text-white", danger: "bg-danger text-white" }[toast.tone]}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-sm ${active ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>
      {children}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function StatusPill({ status }: { status: RecentSale["status"] }) {
  const map = { synced: ["Sincronizada", "bg-success/15 text-success"], pending: ["Pendiente", "bg-warning/15 text-warning"], conflict: ["Con observaciones", "bg-warning/15 text-warning"], rejected: ["Rechazada", "bg-danger/15 text-danger"] } as const;
  const [label, cls] = map[status];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}
