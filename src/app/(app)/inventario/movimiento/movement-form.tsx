"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Alert, Button, ButtonLink, Card } from "@/components/ui";
import { VariantPicker, type PickedVariant } from "@/components/variant-picker";
import { formatQty } from "@/lib/money";
import { registerAdjustmentAction } from "../actions";
import { Field, MoneyInput } from "../../catalogo/product-form";

const TYPES = [
  { value: "adjustment_in", label: "Entrada (ajuste positivo)", inbound: true },
  { value: "opening", label: "Existencia inicial", inbound: true },
  { value: "adjustment_out", label: "Salida (ajuste negativo)", inbound: false },
  { value: "shrinkage", label: "Merma", inbound: false },
  { value: "damaged", label: "Producto dañado", inbound: false },
  { value: "expired", label: "Producto caducado", inbound: false },
] as const;

export function MovementForm({ warehouses, defaultWarehouseId, canCost, currency }: { warehouses: Array<{ id: string; label: string }>; defaultWarehouseId: string; canCost: boolean; currency: string }) {
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId);
  const [variant, setVariant] = useState<PickedVariant | null>(null);
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("adjustment_in");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string; fields?: Record<string, string[]> } | null>(null);
  const [pending, start] = useTransition();
  const inbound = TYPES.find((t) => t.value === type)!.inbound;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!variant) {
      setResult({ ok: false, text: "Elige un producto." });
      return;
    }
    start(async () => {
      const res = await registerAdjustmentAction({ warehouseId, variantId: variant.id, movementType: type, quantity, unitCost: inbound && canCost ? unitCost || null : null, reason });
      if (res.ok) {
        setResult({ ok: true, text: `Registrado. Existencia actual de ${variant.name}: ${formatQty(res.data.onHand)}.` });
        setVariant(null);
        setQuantity("");
        setUnitCost("");
      } else setResult({ ok: false, text: res.error, fields: res.fieldErrors });
    });
  }
  const err = (k: string) => result?.fields?.[k]?.join(" ");

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {result && (
          <Alert tone={result.ok ? "success" : "danger"} title={result.text}>
            {result.ok && variant === null && <Link className="link" href="/inventario">Ver existencias</Link>}
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Almacén" required>
            <select className="field" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
            </select>
          </Field>
          <Field label="Tipo de movimiento" required>
            <select className="field" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Producto" required error={err("variantId")}>
              <VariantPicker value={variant} onChange={setVariant} currency={currency} autoFocus />
            </Field>
          </div>
          <Field label="Cantidad" required error={err("quantity")} hint={inbound ? "Se suma a la existencia." : "Se resta de la existencia."}>
            <input className="field" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          {inbound && canCost && (
            <Field label="Costo unitario" hint="Opcional. Recalcula el costo promedio y actualiza el último costo." error={err("unitCost")}>
              <MoneyInput value={unitCost} onChange={setUnitCost} />
            </Field>
          )}
          <div className="sm:col-span-2">
            <Field label="Motivo" required error={err("reason")} hint="Queda en el kardex y en la bitácora.">
              <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="p. ej. Conteo de fin de mes, producto roto en anaquel" />
            </Field>
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>{pending ? "Registrando…" : "Registrar movimiento"}</Button>
          <ButtonLink variant="ghost" href="/inventario">Volver</ButtonLink>
        </div>
      </form>
    </Card>
  );
}
