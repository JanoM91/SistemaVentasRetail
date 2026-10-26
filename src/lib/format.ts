/** Utilidades de formato (fechas y dinero) dependientes de la configuración de la empresa. */

export function formatDateTime(date: Date | string | null | undefined, timeZone = "America/Mexico_City", locale = "es-MX"): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatDate(date: Date | string | null | undefined, timeZone = "America/Mexico_City", locale = "es-MX"): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, { timeZone, day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

/** Importes en centavos enteros → texto con símbolo. */
export function formatMoney(cents: number | bigint, currency = "MXN", locale = "es-MX", minorUnit = 2): string {
  const n = Number(cents) / 10 ** minorUnit;
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: minorUnit }).format(n);
}
