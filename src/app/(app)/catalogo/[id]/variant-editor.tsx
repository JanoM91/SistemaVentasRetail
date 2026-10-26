"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Alert, Badge, Button } from "@/components/ui";
import { formatCents, formatQty } from "@/lib/money";
import { addVariantAction, setVariantActiveAction, updateVariantAction } from "../actions";
import { MoneyInput } from "../product-form";

export type EditableVariant = {
  id: string;
  sku: string;
  variantName: string;
  attributeValues: Record<string, string>;
  price: number;
  cost: number | null;
  barcodes: string[];
  minStock: string | null;
  reorderPoint: string | null;
  active: boolean;
  stock: Array<{ code: string; onHand: number }>;
};

const toInput = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));
const splitCodes = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

export function VariantEditor({
  productId,
  kind,
  attributeNames,
  variants,
  currency,
  canEdit,
  canPrice,
  canCost,
  canDisable,
  canStock,
  trackStock,
}: {
  productId: string;
  kind: "simple" | "variable";
  attributeNames: string[];
  variants: EditableVariant[];
  currency: string;
  canEdit: boolean;
  canPrice: boolean;
  canCost: boolean;
  canDisable: boolean;
  canStock: boolean;
  trackStock: boolean;
}) {
  return (
    <div className="space-y-3">
      {variants.map((v) => (
        <VariantRow key={v.id} v={v} productId={productId} kind={kind} attributeNames={attributeNames} currency={currency} canEdit={canEdit} canPrice={canPrice} canCost={canCost} canDisable={canDisable} trackStock={trackStock} />
      ))}
      {kind === "variable" && canEdit && <NewVariant productId={productId} attributeNames={attributeNames} canCost={canCost} canStock={canStock && trackStock} />}
    </div>
  );
}

function VariantRow({ v, productId, kind, attributeNames, currency, canEdit, canPrice, canCost, canDisable, trackStock }: { v: EditableVariant; productId: string; kind: "simple" | "variable"; attributeNames: string[]; currency: string; canEdit: boolean; canPrice: boolean; canCost: boolean; canDisable: boolean; trackStock: boolean }) {
  const [editing, setEditing] = useState(false);
  const [sku, setSku] = useState(v.sku);
  const [price, setPrice] = useState(toInput(v.price));
  const [cost, setCost] = useState(toInput(v.cost));
  const [codes, setCodes] = useState(v.barcodes.join(", "));
  const [minStock, setMinStock] = useState(v.minStock ?? "");
  const [reorderPoint, setReorderPoint] = useState(v.reorderPoint ?? "");
  const [attrs, setAttrs] = useState(v.attributeValues);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const total = v.stock.reduce((a, s) => a + s.onHand, 0);

  function save() {
    start(async () => {
      const res = await updateVariantAction(v.id, productId, {
        sku,
        price,
        cost: canCost ? cost || null : null,
        barcodes: splitCodes(codes),
        minStock: minStock || null,
        reorderPoint: reorderPoint || null,
        attributeValues: kind === "variable" ? attrs : undefined,
      });
      if (res.ok) {
        setMsg({ ok: true, text: "Guardado." });
        setEditing(false);
      } else setMsg({ ok: false, text: res.error + (res.fieldErrors ? " " + Object.values(res.fieldErrors).flat().join(" ") : "") });
    });
  }
  function toggle() {
    start(async () => {
      const res = await setVariantActiveAction(v.id, productId, !v.active);
      setMsg(res.ok ? { ok: true, text: v.active ? "Variante desactivada." : "Variante activada." } : { ok: false, text: res.error });
    });
  }

  return (
    <div className={`rounded-app border border-border p-3 ${v.active ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">
            {kind === "variable" ? v.variantName : "Variante única"} {!v.active && <Badge tone="danger">Inactiva</Badge>}
          </p>
          <p className="font-mono text-xs text-muted">{v.sku}{v.barcodes.length > 0 && ` · ${v.barcodes.join(", ")}`}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold">{formatCents(v.price, currency)}</p>
          {canCost && <p className="text-xs text-muted">Costo {v.cost === null ? <Badge tone="warning">sin costo</Badge> : formatCents(v.cost, currency)}</p>}
          {trackStock && (
            <p className="text-xs text-muted">
              <Link className="link" href={`/inventario/kardex/${v.id}`}>Existencia {formatQty(total)}</Link>
              {v.stock.length > 1 && ` (${v.stock.map((s) => `${s.code}: ${formatQty(s.onHand)}`).join(", ")})`}
            </p>
          )}
        </div>
      </div>
      {msg && <div className="mt-2"><Alert tone={msg.ok ? "success" : "danger"}>{msg.text}</Alert></div>}
      {editing ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {kind === "variable" &&
            attributeNames.map((n) => (
              <label key={n} className="text-sm">{n}<input className="field mt-1" value={attrs[n] ?? ""} onChange={(e) => setAttrs((a) => ({ ...a, [n]: e.target.value }))} /></label>
            ))}
          <label className="text-sm">SKU<input className="field mt-1 font-mono" value={sku} onChange={(e) => setSku(e.target.value.toUpperCase())} /></label>
          <label className="text-sm">Precio{!canPrice && <span className="text-xs text-muted"> (sin permiso)</span>}<div className="mt-1"><MoneyInput value={price} onChange={canPrice ? setPrice : () => {}} /></div></label>
          {canCost && <label className="text-sm">Costo<div className="mt-1"><MoneyInput value={cost} onChange={setCost} /></div></label>}
          <label className="text-sm sm:col-span-2">Códigos de barras<input className="field mt-1" value={codes} onChange={(e) => setCodes(e.target.value)} /></label>
          {trackStock && <label className="text-sm">Existencia mínima<input className="field mt-1" inputMode="decimal" value={minStock} onChange={(e) => setMinStock(e.target.value)} /></label>}
          {trackStock && <label className="text-sm">Punto de reorden<input className="field mt-1" inputMode="decimal" value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} /></label>}
          <div className="flex items-end gap-2 sm:col-span-3">
            <Button type="button" onClick={save} disabled={pending}>{pending ? "Guardando…" : "Guardar variante"}</Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
          </div>
        </div>
      ) : (
        (canEdit || canDisable) && (
          <div className="mt-2 flex gap-2">
            {canEdit && <Button type="button" variant="secondary" className="!min-h-9" onClick={() => { setMsg(null); setEditing(true); }}>Editar</Button>}
            {canDisable && kind === "variable" && <Button type="button" variant="ghost" className="!min-h-9" onClick={toggle} disabled={pending}>{v.active ? "Desactivar" : "Activar"}</Button>}
          </div>
        )
      )}
    </div>
  );
}

function NewVariant({ productId, attributeNames, canCost, canStock }: { productId: string; attributeNames: string[]; canCost: boolean; canStock: boolean }) {
  const [open, setOpen] = useState(false);
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [codes, setCodes] = useState("");
  const [stock, setStock] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) return <Button type="button" variant="secondary" onClick={() => setOpen(true)}>Agregar variante</Button>;
  function save() {
    start(async () => {
      const res = await addVariantAction(productId, { sku, attributeValues: attrs, price, cost: cost || null, barcodes: splitCodes(codes), initialStock: stock || null });
      if (res.ok) {
        setOpen(false);
        setAttrs({}); setSku(""); setPrice(""); setCost(""); setCodes(""); setStock(""); setMsg(null);
      } else setMsg(res.error + (res.fieldErrors ? " " + Object.values(res.fieldErrors).flat().join(" ") : ""));
    });
  }
  return (
    <div className="rounded-app border border-dashed border-border p-3">
      <p className="mb-2 font-medium">Nueva variante</p>
      {msg && <div className="mb-2"><Alert tone="danger">{msg}</Alert></div>}
      <div className="grid gap-3 sm:grid-cols-3">
        {attributeNames.map((n) => (
          <label key={n} className="text-sm">{n}<input className="field mt-1" value={attrs[n] ?? ""} onChange={(e) => setAttrs((a) => ({ ...a, [n]: e.target.value }))} /></label>
        ))}
        <label className="text-sm">SKU<input className="field mt-1 font-mono" value={sku} onChange={(e) => setSku(e.target.value.toUpperCase())} /></label>
        <label className="text-sm">Precio<div className="mt-1"><MoneyInput value={price} onChange={setPrice} /></div></label>
        {canCost && <label className="text-sm">Costo<div className="mt-1"><MoneyInput value={cost} onChange={setCost} /></div></label>}
        <label className="text-sm">Códigos de barras<input className="field mt-1" value={codes} onChange={(e) => setCodes(e.target.value)} /></label>
        {canStock && <label className="text-sm">Existencia inicial<input className="field mt-1" inputMode="decimal" value={stock} onChange={(e) => setStock(e.target.value)} /></label>}
      </div>
      <div className="mt-3 flex gap-2">
        <Button type="button" onClick={save} disabled={pending}>{pending ? "Guardando…" : "Agregar"}</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
      </div>
    </div>
  );
}
