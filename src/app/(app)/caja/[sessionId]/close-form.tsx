"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button } from "@/components/ui";
import { formatCents, MXN_DENOMINATIONS } from "@/lib/money";
import { closeSessionAction } from "../actions";

/** Corte Z: conteo por denominación (o total directo) y cierre del turno. */
export function CloseForm({ sessionId, expected, showExpected, currency }: { sessionId: string; expected: number; showExpected: boolean; currency: string }) {
  const router = useRouter();
  const [pieces, setPieces] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const counted = useMemo(() => Object.entries(pieces).reduce((a, [v, n]) => a + Number(v) * (Number(n) || 0), 0), [pieces]);
  const diff = counted - expected;

  function submit() {
    setError(null);
    const denominations = Object.fromEntries(Object.entries(pieces).filter(([, n]) => Number(n) > 0).map(([v, n]) => [v, Math.floor(Number(n))]));
    start(async () => {
      const res = await closeSessionAction({ cashSessionId: sessionId, denominations: Object.keys(denominations).length ? denominations : undefined, countedCash: Object.keys(denominations).length ? undefined : "0", notes });
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Cuenta el efectivo del cajón por denominación. {showExpected ? "Se compara con lo esperado." : "El sistema compara contra lo esperado al cerrar (no se muestra para un conteo a ciegas)."}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {MXN_DENOMINATIONS.map((d) => (
          <label key={d} className="flex items-center gap-2 rounded-app border border-border px-2 py-1.5 text-sm">
            <span className="w-16 shrink-0 font-medium">{formatCents(d, currency).replace(".00", "")}</span>
            <span className="text-muted">×</span>
            <input
              className="field !min-h-9 !py-1 text-right"
              inputMode="numeric"
              value={pieces[d] ?? ""}
              onChange={(e) => setPieces((p) => ({ ...p, [d]: e.target.value.replace(/\D/g, "") }))}
              aria-label={`Piezas de ${d / 100}`}
            />
          </label>
        ))}
      </div>
      <div className="grid gap-3 rounded-app bg-surface-2 p-3 text-sm sm:grid-cols-3">
        <div><p className="text-muted">Contado</p><p className="text-xl font-semibold">{formatCents(counted, currency)}</p></div>
        {showExpected && <div><p className="text-muted">Esperado</p><p className="text-xl font-semibold">{formatCents(expected, currency)}</p></div>}
        {showExpected && (
          <div>
            <p className="text-muted">Diferencia</p>
            <p className={`text-xl font-semibold ${diff === 0 ? "text-success" : "text-danger"}`}>{diff > 0 ? "+" : ""}{formatCents(diff, currency)}</p>
            <p className="text-xs text-muted">{diff === 0 ? "Cuadra" : diff > 0 ? "Sobrante" : "Faltante"}</p>
          </div>
        )}
      </div>
      <label className="block text-sm">Notas del cierre<input className="field mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional: explica cualquier diferencia" /></label>
      {error && <Alert tone="danger">{error}</Alert>}
      {confirm ? (
        <div className="flex flex-wrap items-center gap-2 rounded-app border border-warning/50 bg-warning/10 p-3">
          <p className="flex-1 text-sm">Al cerrar el turno no podrás vender en esta caja hasta abrir uno nuevo. ¿Confirmas el corte Z con {formatCents(counted, currency)} contados?</p>
          <Button type="button" variant="ghost" onClick={() => setConfirm(false)}>Revisar</Button>
          <Button type="button" variant="danger" onClick={submit} disabled={pending}>{pending ? "Cerrando…" : "Cerrar turno"}</Button>
        </div>
      ) : (
        <Button type="button" onClick={() => setConfirm(true)}>Hacer corte Z</Button>
      )}
    </div>
  );
}
