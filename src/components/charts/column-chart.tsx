"use client";

import { useState } from "react";

export type Column = { label: string; value: number; tooltip: string };

const compact = (v: number) => (Math.abs(v) >= 1_000_000 ? `${Math.round(v / 100_000) / 10} M` : Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10} K` : String(Math.round(v)));
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v)!;
}

/**
 * Columnas de una sola serie (sin leyenda: el título dice qué se mide).
 * Columnas de máximo 24 px con 4 px redondeados en la punta, cuadrícula
 * discreta y tooltip al pasar el cursor o enfocar con teclado.
 * `scale` convierte el valor a unidades del eje (p. ej. centavos → pesos).
 */
export function ColumnChart({ data, ariaLabel, scale = 1, height = 180, maxLabels = 12 }: { data: Column[]; ariaLabel: string; scale?: number; height?: number; maxLabels?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value / scale)));
  const ticks = [0, max / 2, max];
  const every = Math.max(1, Math.ceil(data.length / maxLabels));
  return (
    <figure className="w-full" aria-label={ariaLabel}>
      <div className="flex gap-2">
        <div className="relative w-10 shrink-0 text-right text-xs tabular-nums text-muted" style={{ height }} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - t / max) * 100}%` }}>{compact(t)}</span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height }}>
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 border-t border-border" style={{ top: `${(1 - t / max) * 100}%` }} aria-hidden />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]" role="list">
            {data.map((d, i) => {
              const h = Math.max(0, (d.value / scale / max) * 100);
              return (
                <div
                  key={i}
                  role="listitem"
                  tabIndex={0}
                  aria-label={d.tooltip}
                  className="group relative flex h-full flex-1 cursor-default items-end justify-center outline-none"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                >
                  <div className={`w-full max-w-6 rounded-t-[4px] ${hover === i ? "bg-primary-hover" : "bg-primary"} ${d.value === 0 ? "opacity-0" : ""}`} style={{ height: `${h}%`, minHeight: d.value > 0 ? 2 : 0 }} />
                  {hover === i && (
                    <div className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-app border border-border bg-surface px-2 py-1 text-xs text-text shadow-lg">{d.tooltip}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="ml-12 mt-1 flex h-4 gap-[2px] text-[11px] text-muted" aria-hidden>
        {data.map((d, i) => (
          <span key={i} className="relative flex-1">
            {i % every === 0 && <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap">{d.label}</span>}
          </span>
        ))}
      </div>
    </figure>
  );
}
