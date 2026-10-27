"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, ButtonLink, Card } from "@/components/ui";
import { LinesEditor, type DocLine } from "@/components/lines-editor";
import { formatCents } from "@/lib/money";
import { Field } from "../../../catalogo/product-form";
import { createSupplierReturnAction } from "../../actions";
import type { SupplierOption, WarehouseOption } from "../../purchase-form";

export function SupplierReturnForm({
  suppliers,
  warehouses,
  currency,
  canCost,
  initial,
}: {
  suppliers: SupplierOption[];
  warehouses: WarehouseOption[];
  currency: string;
  canCost: boolean;
  initial: { supplierId: string; warehouseId: string; receiptId: string; receiptFolio: string | null; lines: DocLine[] };
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(initial.supplierId);
  const [warehouseId, setWarehouseId] = useState(initial.warehouseId);
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<DocLine[]>(initial.lines);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; fields?: Record<string, string[]> } | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    start(async () => {
      const res = await createSupplierReturnAction({
        supplierId,
        warehouseId,
        receiptId: initial.receiptId,
        reason,
        lines: lines.map((l) => ({ variantId: l.variant.id, quantity: l.quantity, unitCost: canCost && l.unitCost ? l.unitCost : null })),
      });
      if (res.ok) {
        setMsg({ ok: true, text: `Devolución ${res.data.folio} registrada. Crédito ${formatCents(res.data.credit, currency)}${res.data.pendingCredit ? ` (${formatCents(res.data.pendingCredit, currency)} queda a favor sin cuenta que abonar)` : " aplicado a cuentas por pagar"}.` });
        setLines([]);
        setReason("");
        router.refresh();
      } else setMsg({ ok: false, text: res.error, fields: res.fieldErrors });
    });
  }
  const err = (k: string) => msg?.fields?.[k]?.join(" ");
  const locked = !!initial.receiptId;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {msg && <Alert tone={msg.ok ? "success" : "danger"} title={msg.text}>{msg.ok && <ButtonLink variant="ghost" href="/compras/devoluciones">Ver devoluciones</ButtonLink>}</Alert>}
      <Card title="Datos">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Proveedor" required error={err("supplierId")}>
            <select className="field" value={supplierId} disabled={locked} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Elige un proveedor</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Sale del almacén" required error={err("warehouseId")}>
            <select className="field" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
            </select>
          </Field>
          {initial.receiptFolio && <p className="text-sm text-muted sm:col-span-2">Contra la recepción <span className="font-mono">{initial.receiptFolio}</span>: el costo y el crédito se toman de esa compra.</p>}
          <div className="sm:col-span-2">
            <Field label="Motivo" required error={err("reason")}>
              <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="p. ej. Producto dañado, caducado, error de surtido" />
            </Field>
          </div>
        </div>
      </Card>
      <Card title="Productos a devolver">
        <LinesEditor lines={lines} onChange={setLines} withCost={canCost && !locked} currency={currency} emptyText="Busca y agrega lo que regresas." />
        {canCost && !locked && <p className="mt-2 text-xs text-muted">Si dejas el costo vacío se usa el costo promedio del almacén.</p>}
      </Card>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || lines.length === 0}>{pending ? "Registrando…" : "Registrar devolución"}</Button>
        <ButtonLink variant="ghost" href="/compras/devoluciones">Volver</ButtonLink>
      </div>
    </form>
  );
}
