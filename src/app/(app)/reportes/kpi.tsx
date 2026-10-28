import type { ReactNode } from "react";
import { change } from "@/lib/period";

/**
 * Indicador con su variación contra el periodo anterior. La flecha y el
 * texto dicen la dirección (no solo el color); «más» no siempre es mejor
 * (devoluciones, cancelaciones), por eso no se pinta de verde o rojo.
 */
export function Kpi({ label, value, current, previous, hint, testId }: { label: string; value: ReactNode; current: number; previous: number; hint?: ReactNode; testId?: string }) {
  const pct = change(current, previous);
  return (
    <div className="rounded-app border border-border bg-surface p-4" data-testid={testId}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted">
        {pct === null ? (previous === 0 && current > 0 ? "sin datos en el periodo anterior" : "sin cambio") : (
          <>
            <span aria-hidden>{pct > 0 ? "▲" : pct < 0 ? "▼" : "="}</span> {pct > 0 ? "+" : ""}{pct.toFixed(1)} % vs. anterior
          </>
        )}
      </p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

const DOW_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
export const dayLabel = (day: string, long = false) => {
  const d = new Date(`${day}T12:00:00Z`);
  return long ? `${DOW_SHORT[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}` : `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
};
