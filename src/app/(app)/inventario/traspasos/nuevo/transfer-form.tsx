"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, ButtonLink, Card } from "@/components/ui";
import { LinesEditor, type DocLine } from "@/components/lines-editor";
import { Field } from "../../../catalogo/product-form";
import { createTransferAction } from "../../actions";

type Wh = { id: string; label: string };

export function TransferForm({ origins, destinations, defaultFrom, currency }: { origins: Wh[]; destinations: Wh[]; defaultFrom: string; currency: string }) {
  const router = useRouter();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(destinations.find((d) => d.id !== defaultFrom)?.id ?? "");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DocLine[]>([]);
  const [error, setError] = useState<{ text: string; fields?: Record<string, string[]> } | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createTransferAction({ fromWarehouseId: from, toWarehouseId: to, notes, lines: lines.map((l) => ({ variantId: l.variant.id, quantity: l.quantity })) });
      if (res.ok) router.push(`/inventario/traspasos/${res.data.id}?nuevo=1`);
      else setError({ text: res.error, fields: res.fieldErrors });
    });
  }
  const err = (k: string) => error?.fields?.[k]?.join(" ");

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert tone="danger" title={error.text} />}
      <Card title="Ruta">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sale de" required error={err("fromWarehouseId")}>
            <select className="field" value={from} onChange={(e) => setFrom(e.target.value)}>
              {origins.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
            </select>
          </Field>
          <Field label="Llega a" required error={err("toWarehouseId")}>
            <select className="field" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Elige el destino</option>
              {destinations.filter((d) => d.id !== from).map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-2"><Field label="Notas" hint="p. ej. quién lo lleva o en qué vehículo."><input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
        </div>
      </Card>
      <Card title="Productos">
        <LinesEditor lines={lines} onChange={setLines} withCost={false} currency={currency} qtyLabel="Envía" />
      </Card>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !lines.length}>{pending ? "Enviando…" : "Enviar traspaso"}</Button>
        <ButtonLink variant="ghost" href="/inventario/traspasos">Cancelar</ButtonLink>
      </div>
    </form>
  );
}
