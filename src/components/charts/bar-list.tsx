/** Barras horizontales con etiqueta y valor en texto (cada fila rotulada; no requiere tooltip). */
export function BarList({ items, ariaLabel }: { items: Array<{ label: string; value: number; display: string; hint?: string }>; ariaLabel: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="text-sm text-muted">Sin datos en el periodo.</p>;
  return (
    <ul className="space-y-2" aria-label={ariaLabel}>
      {items.map((i) => (
        <li key={i.label} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate" title={i.label}>{i.label}</span>
          <span className="h-3 rounded-r-[4px] bg-primary" style={{ width: `${Math.max(1, (i.value / max) * 100)}%` }} aria-hidden />
          <span className="text-right tabular-nums">{i.display}{i.hint && <span className="block text-xs text-muted">{i.hint}</span>}</span>
        </li>
      ))}
    </ul>
  );
}
