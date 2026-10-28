/**
 * Periodos de reporte en la zona horaria de la empresa. Una fecha local
 * (AAAA-MM-DD) se convierte al instante en que empieza ese día en la zona,
 * para que «hoy» o «este mes» corten a medianoche local y no en UTC.
 */

export const PERIOD_PRESETS = {
  hoy: "Hoy",
  ayer: "Ayer",
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  mes: "Este mes",
  "mes-anterior": "Mes anterior",
  anio: "Este año",
} as const;
export type PeriodPreset = keyof typeof PERIOD_PRESETS;

/** Fecha local AAAA-MM-DD de un instante en la zona. */
export function localDay(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Instante en que empieza el día local `day` en la zona `tz` (maneja horario de verano). */
export function startOfLocalDay(day: string, tz: string): Date {
  const utcMidnight = new Date(`${day}T00:00:00Z`);
  // Diferencia entre la hora de pared en la zona y UTC para ese instante; se corrige dos veces por cambios de horario.
  let guess = utcMidnight.getTime();
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(guess));
    const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const wall = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
    guess -= wall - utcMidnight.getTime();
  }
  return new Date(guess);
}

export function addDaysIso(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

export type Period = {
  /** Días locales inclusivos. */
  fromDay: string;
  toDay: string;
  /** Instantes [from, to). */
  from: Date;
  to: Date;
  days: number;
  label: string;
  preset: PeriodPreset | "personalizado";
  previous: { fromDay: string; toDay: string; from: Date; to: Date; label: string };
};

const fmt = (day: string) => new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

/** Resuelve un periodo a partir de un preset o de fechas locales (el preset gana si viene). */
export function resolvePeriod(tz: string, opts: { preset?: string | null; from?: string | null; to?: string | null; now?: Date }): Period {
  const today = localDay(opts.now ?? new Date(), tz);
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  let fromDay: string;
  let toDay: string;
  let preset: Period["preset"] = (opts.preset as PeriodPreset) in PERIOD_PRESETS ? (opts.preset as PeriodPreset) : opts.from && iso.test(opts.from) ? "personalizado" : "7d";
  switch (preset) {
    case "hoy": fromDay = toDay = today; break;
    case "ayer": fromDay = toDay = addDaysIso(today, -1); break;
    case "30d": fromDay = addDaysIso(today, -29); toDay = today; break;
    case "mes": fromDay = `${today.slice(0, 7)}-01`; toDay = today; break;
    case "mes-anterior": {
      const firstThis = `${today.slice(0, 7)}-01`;
      toDay = addDaysIso(firstThis, -1);
      fromDay = `${toDay.slice(0, 7)}-01`;
      break;
    }
    case "anio": fromDay = `${today.slice(0, 4)}-01-01`; toDay = today; break;
    case "personalizado": {
      fromDay = opts.from!;
      toDay = opts.to && iso.test(opts.to) && opts.to >= fromDay ? opts.to : fromDay;
      if (daysBetween(fromDay, toDay) > 731) fromDay = addDaysIso(toDay, -731);
      break;
    }
    default: preset = "7d"; fromDay = addDaysIso(today, -6); toDay = today;
  }
  const days = daysBetween(fromDay, toDay) + 1;
  const prevTo = addDaysIso(fromDay, -1);
  const prevFrom = addDaysIso(prevTo, -(days - 1));
  return {
    fromDay,
    toDay,
    from: startOfLocalDay(fromDay, tz),
    to: startOfLocalDay(addDaysIso(toDay, 1), tz),
    days,
    preset,
    label: fromDay === toDay ? fmt(fromDay) : `${fmt(fromDay)} – ${fmt(toDay)}`,
    previous: { fromDay: prevFrom, toDay: prevTo, from: startOfLocalDay(prevFrom, tz), to: startOfLocalDay(fromDay, tz), label: prevFrom === prevTo ? fmt(prevFrom) : `${fmt(prevFrom)} – ${fmt(prevTo)}` },
  };
}

/** Variación porcentual (null si no hay base). */
export function change(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}
