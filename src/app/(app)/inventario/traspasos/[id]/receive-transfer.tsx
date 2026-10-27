"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card } from "@/components/ui";
import { formatQty } from "@/lib/money";
import { receiveTransferAction } from "../../actions";

type Line = { id: string; label: string; sku: string; sent: number };

/** Confirmación de lo que llegó: se precarga lo enviado; las diferencias quedan registradas. */
export function ReceiveTransfer({ transferId, lines }: { transferId: string; lines: Line[] }) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, String(l.sent)])));
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const diffs = lines.filter((l) => Number(qty[l.id] || 0) !== l.sent).length;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await receiveTransferAction(transferId, { notes, lines: lines.map((l) => ({ lineId: l.id, quantityReceived: qty[l.id] || "0" })) });
      if (res.ok) router.replace(`/inventario/traspasos/${transferId}?recibido=${res.data.differences}`);
      else setMsg({ ok: false, text: res.error });
    });
  }

  return (
    <Card title="Recibir en destino">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {msg && <Alert tone={msg.ok ? "success" : "danger"} title={msg.text} />}
        <div className="overflow-x-auto rounded-app border border-border">
          <table className="table">
            <thead><tr><th>Producto</th><th className="text-right">Enviado</th><th className="w-28">Llegó</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td><span className="block font-medium">{l.label}</span><span className="font-mono text-xs text-muted">{l.sku}</span></td>
                  <td className="text-right">{formatQty(l.sent)}</td>
                  <td><input className={`field !min-h-9 !py-1 ${Number(qty[l.id] || 0) !== l.sent ? "field-error" : ""}`} inputMode="decimal" aria-label={`Llegó de ${l.label}`} value={qty[l.id]} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value.replace(/[^0-9.]/g, "") })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label className="block space-y-1">
          <span className="block text-sm font-medium">Notas de recepción{diffs > 0 && <span className="text-danger"> · explica la diferencia</span>}</span>
          <input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <Button type="submit" disabled={pending}>{pending ? "Registrando…" : diffs ? `Recibir con ${diffs} diferencia(s)` : "Confirmar recepción"}</Button>
      </form>
    </Card>
  );
}
