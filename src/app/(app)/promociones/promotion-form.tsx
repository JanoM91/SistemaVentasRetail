"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Button, ButtonLink, Card } from "@/components/ui";
import { VariantPicker } from "@/components/variant-picker";
import { PROMOTION_KIND_LABELS, PROMOTION_KINDS, type PromotionKind } from "@/lib/promotions";
import { Field, MoneyInput } from "../catalogo/product-form";
import { savePromotionAction } from "./actions";
import type { PromotionFormValues } from "./promotion-values";

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const HINTS: Record<PromotionKind, string> = {
  percent: "Ej. 10 % en Bebidas.",
  amount: "Ej. $5 menos en cada pieza.",
  special_price: "Ej. Refresco a $15 los martes.",
  buy_x_pay_y: "Ej. 2x1 o 3x2: la pieza más barata sale gratis.",
  volume: "Ej. 5 % desde 6 piezas y 10 % desde 12.",
  bundle: "Ej. Torta + refresco por $60.",
  order_percent: "Ej. 10 % en toda la compra (ideal con cupón).",
  order_amount: "Ej. $50 menos en compras desde $500.",
};

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function PromotionForm({
  id,
  initial,
  categories,
  branches,
  groups,
  currency,
}: {
  id?: string;
  initial: PromotionFormValues;
  categories: Array<{ id: string; name: string }>;
  branches: Array<{ id: string; name: string }>;
  groups: Array<{ id: string; name: string }>;
  currency: string;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [error, setError] = useState<{ text: string; fields?: Record<string, string[]> } | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof PromotionFormValues>(k: K, val: PromotionFormValues[K]) => setV((x) => ({ ...x, [k]: val }));
  const k = v.kind;
  const lineLevel = k !== "order_percent" && k !== "order_amount" && k !== "bundle";
  const err = (f: string) => error?.fields?.[f]?.join(" ");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await savePromotionAction(id ?? null, {
        name: v.name,
        description: v.description,
        kind: v.kind,
        percent: v.percent,
        amount: v.amount,
        buyQty: v.buyQty,
        payQty: v.payQty,
        tiers: v.tiers.filter((t) => t.minQty && t.percent),
        bundle: v.bundle.map((b) => ({ variantId: b.variantId, qty: b.qty })),
        bundlePrice: v.bundlePrice,
        scope: lineLevel ? v.scope : "all",
        categoryIds: v.categoryIds,
        productIds: v.products.map((p) => p.id),
        startsAt: v.startsAt,
        endsAt: v.endsAt,
        daysOfWeek: v.daysOfWeek,
        timeFrom: v.timeFrom,
        timeTo: v.timeTo,
        branchIds: v.branchIds,
        customerGroupIds: v.customerGroupIds,
        requiresCoupon: v.requiresCoupon,
        minPurchase: v.minPurchase,
        maxUses: v.maxUses,
        maxUsesPerCustomer: v.maxUsesPerCustomer,
        priority: v.priority || "0",
        stackable: v.stackable,
      });
      if (res.ok) router.push(`/promociones/${res.data.id}?guardada=1`);
      else setError({ text: res.error, fields: res.fieldErrors });
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert tone="danger" title={error.text}>{error.fields && Object.values(error.fields).flat().join(" ")}</Alert>}
      <Card title="¿Qué descuento da?">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" required error={err("name")} hint="Aparece en el ticket como explicación.">
            <input className="field" value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="p. ej. 2x1 en refrescos" />
          </Field>
          <Field label="Tipo" required hint={HINTS[k]}>
            <select className="field" value={k} onChange={(e) => set("kind", e.target.value as PromotionKind)} aria-label="Tipo de promoción">
              {PROMOTION_KINDS.map((x) => <option key={x} value={x}>{PROMOTION_KIND_LABELS[x]}</option>)}
            </select>
          </Field>
          {(k === "percent" || k === "order_percent") && (
            <Field label="Porcentaje" required error={err("percent")}>
              <input className="field" inputMode="decimal" value={v.percent} onChange={(e) => set("percent", e.target.value)} placeholder="10" aria-label="Porcentaje" />
            </Field>
          )}
          {(k === "amount" || k === "special_price" || k === "order_amount") && (
            <Field label={k === "special_price" ? "Precio especial" : k === "amount" ? "Descuento por pieza" : "Descuento al ticket"} required error={err("amount")}>
              <MoneyInput value={v.amount} onChange={(x) => set("amount", x)} />
            </Field>
          )}
          {k === "buy_x_pay_y" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Lleva" required error={err("buyQty")}><input className="field" inputMode="numeric" value={v.buyQty} onChange={(e) => set("buyQty", e.target.value)} aria-label="Lleva" /></Field>
              <Field label="Paga" required><input className="field" inputMode="numeric" value={v.payQty} onChange={(e) => set("payQty", e.target.value)} aria-label="Paga" /></Field>
            </div>
          )}
          {k === "volume" && (
            <div className="space-y-2 sm:col-span-2">
              <p className="text-sm font-medium">Tramos {err("tiers") && <span className="text-danger">· {err("tiers")}</span>}</p>
              {v.tiers.map((t, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  Desde <input className="field !w-24" inputMode="decimal" value={t.minQty} onChange={(e) => set("tiers", v.tiers.map((x, j) => (j === i ? { ...x, minQty: e.target.value } : x)))} aria-label="Desde piezas" /> piezas,
                  <input className="field !w-20" inputMode="decimal" value={t.percent} onChange={(e) => set("tiers", v.tiers.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))} aria-label="Porcentaje del tramo" /> %
                  <button type="button" className="p-1 text-danger" aria-label="Quitar tramo" onClick={() => set("tiers", v.tiers.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>
                </div>
              ))}
              <button type="button" className="inline-flex items-center gap-1 text-sm text-primary" onClick={() => set("tiers", [...v.tiers, { minQty: "", percent: "" }])}><Plus className="size-4" /> Agregar tramo</button>
            </div>
          )}
          {k === "bundle" && (
            <div className="space-y-2 sm:col-span-2">
              <p className="text-sm font-medium">Productos del paquete {err("bundle") && <span className="text-danger">· {err("bundle")}</span>}</p>
              {v.bundle.map((b, i) => (
                <div key={b.variantId} className="flex items-center gap-2 rounded-app border border-border p-2 text-sm">
                  <span className="flex-1">{b.label}</span>
                  <input className="field !w-20" inputMode="numeric" value={b.qty} onChange={(e) => set("bundle", v.bundle.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} aria-label={`Cantidad de ${b.label}`} />
                  <button type="button" className="p-1 text-danger" aria-label="Quitar" onClick={() => set("bundle", v.bundle.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>
                </div>
              ))}
              <VariantPicker value={null} currency={currency} onChange={(p) => p && !v.bundle.some((b) => b.variantId === p.id) && set("bundle", [...v.bundle, { variantId: p.id, label: `${p.name}${p.variantName ? ` · ${p.variantName}` : ""}`, qty: "1" }])} />
              <Field label="Precio del paquete" required error={err("bundlePrice")}><MoneyInput value={v.bundlePrice} onChange={(x) => set("bundlePrice", x)} /></Field>
            </div>
          )}
          <div className="sm:col-span-2">
            <Field label="Descripción interna"><input className="field" value={v.description} onChange={(e) => set("description", e.target.value)} /></Field>
          </div>
        </div>
      </Card>

      {lineLevel && (
        <Card title="¿A qué productos?">
          <div className="flex flex-wrap gap-2">
            {([["all", "Todos"], ["categories", "Categorías"], ["products", "Productos"]] as const).map(([s, label]) => (
              <button type="button" key={s} onClick={() => set("scope", s)} className={`rounded-app border px-4 py-2 text-sm ${v.scope === s ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>{label}</button>
            ))}
          </div>
          {v.scope === "categories" && (
            <div className="mt-3 flex flex-wrap gap-2">
              {err("categoryIds") && <p className="w-full text-sm text-danger">{err("categoryIds")}</p>}
              {categories.map((c) => (
                <label key={c.id} className="flex items-center gap-2 rounded-app border border-border px-3 py-2 text-sm">
                  <input type="checkbox" className="accent-primary" checked={v.categoryIds.includes(c.id)} onChange={() => set("categoryIds", toggle(v.categoryIds, c.id))} /> {c.name}
                </label>
              ))}
            </div>
          )}
          {v.scope === "products" && (
            <div className="mt-3 space-y-2">
              {err("productIds") && <p className="text-sm text-danger">{err("productIds")}</p>}
              <div className="flex flex-wrap gap-2">
                {v.products.map((p) => (
                  <span key={p.id} className="flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">
                    {p.name}
                    <button type="button" aria-label={`Quitar ${p.name}`} onClick={() => set("products", v.products.filter((x) => x.id !== p.id))}><Trash2 className="size-3.5" /></button>
                  </span>
                ))}
              </div>
              <VariantPicker value={null} currency={currency} onChange={(p) => p?.productId && !v.products.some((x) => x.id === p.productId) && set("products", [...v.products, { id: p.productId, name: p.name }])} />
              <p className="text-xs text-muted">Se aplica a todas las variantes (tallas, colores) del producto.</p>
            </div>
          )}
        </Card>
      )}

      <Card title="¿Cuándo y para quién?">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Desde" hint="Vacío = desde ya."><input type="date" className="field" value={v.startsAt} onChange={(e) => set("startsAt", e.target.value)} aria-label="Desde" /></Field>
          <Field label="Hasta" error={err("endsAt")} hint="Vacío = sin fin."><input type="date" className="field" value={v.endsAt} onChange={(e) => set("endsAt", e.target.value)} aria-label="Hasta" /></Field>
          <div className="sm:col-span-2">
            <p className="mb-1 text-sm font-medium">Días <span className="font-normal text-muted">(ninguno = todos)</span></p>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d, i) => (
                <button type="button" key={d} onClick={() => set("daysOfWeek", toggle(v.daysOfWeek, i).sort())} className={`min-w-12 rounded-app border px-3 py-2 text-sm ${v.daysOfWeek.includes(i) ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>{d}</button>
              ))}
            </div>
          </div>
          <Field label="Desde la hora" hint="Hora de la empresa, p. ej. 14:00."><input type="time" className="field" value={v.timeFrom} onChange={(e) => set("timeFrom", e.target.value)} aria-label="Desde la hora" /></Field>
          <Field label="Hasta la hora" error={err("timeTo")}><input type="time" className="field" value={v.timeTo} onChange={(e) => set("timeTo", e.target.value)} aria-label="Hasta la hora" /></Field>
          {branches.length > 1 && (
            <div className="sm:col-span-2">
              <p className="mb-1 text-sm font-medium">Sucursales <span className="font-normal text-muted">(ninguna = todas)</span></p>
              <div className="flex flex-wrap gap-2">
                {branches.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 rounded-app border border-border px-3 py-2 text-sm"><input type="checkbox" className="accent-primary" checked={v.branchIds.includes(b.id)} onChange={() => set("branchIds", toggle(v.branchIds, b.id))} /> {b.name}</label>
                ))}
              </div>
            </div>
          )}
          {groups.length > 0 && (
            <div className="sm:col-span-2">
              <p className="mb-1 text-sm font-medium">Solo para grupos de clientes <span className="font-normal text-muted">(ninguno = público en general)</span></p>
              <div className="flex flex-wrap gap-2">
                {groups.map((g) => (
                  <label key={g.id} className="flex items-center gap-2 rounded-app border border-border px-3 py-2 text-sm"><input type="checkbox" className="accent-primary" checked={v.customerGroupIds.includes(g.id)} onChange={() => set("customerGroupIds", toggle(v.customerGroupIds, g.id))} /> {g.name}</label>
                ))}
              </div>
            </div>
          )}
          <Field label="Compra mínima" hint="Importe de los productos antes de descuentos."><MoneyInput value={v.minPurchase} onChange={(x) => set("minPurchase", x)} /></Field>
          <label className="flex items-start gap-3 rounded-app border border-border px-3 py-2.5">
            <input type="checkbox" className="mt-1 size-4 accent-primary" checked={v.requiresCoupon} onChange={(e) => set("requiresCoupon", e.target.checked)} aria-label="Requiere cupón" />
            <span><span className="block text-sm font-medium">Requiere cupón</span><span className="block text-xs text-muted">Solo aplica si en caja se captura un código válido.</span></span>
          </label>
        </div>
      </Card>

      <Card title="Límites y combinación">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Usos totales" hint="Vacío = sin límite."><input className="field" inputMode="numeric" value={v.maxUses} onChange={(e) => set("maxUses", e.target.value)} aria-label="Usos totales" /></Field>
          <Field label="Usos por cliente" hint="Requiere cliente en la venta."><input className="field" inputMode="numeric" value={v.maxUsesPerCustomer} onChange={(e) => set("maxUsesPerCustomer", e.target.value)} aria-label="Usos por cliente" /></Field>
          <Field label="Prioridad (0–100)" hint="Mayor se aplica primero."><input className="field" inputMode="numeric" value={v.priority} onChange={(e) => set("priority", e.target.value)} aria-label="Prioridad" /></Field>
          <label className="flex items-start gap-3 rounded-app border border-border px-3 py-2.5 sm:col-span-3">
            <input type="checkbox" className="mt-1 size-4 accent-primary" checked={v.stackable} onChange={(e) => set("stackable", e.target.checked)} aria-label="Acumulable" />
            <span><span className="block text-sm font-medium">Acumulable con otras promociones</span><span className="block text-xs text-muted">Solo si en Configuración está permitido acumular. Si no, cada producto recibe solo la promoción de mayor prioridad.</span></span>
          </label>
        </div>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Guardando…" : id ? "Guardar cambios" : "Crear promoción"}</Button>
        <ButtonLink variant="ghost" href={id ? `/promociones/${id}` : "/promociones"}>Cancelar</ButtonLink>
      </div>
    </form>
  );
}
