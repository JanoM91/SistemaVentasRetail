/**
 * Cálculo de importes. Código puro, compartido por el POS (navegador, también
 * offline) y el servidor, para que ambos obtengan exactamente el mismo total.
 *
 * Reglas:
 * - Todo importe es un entero en centavos.
 * - Las cantidades admiten hasta 3 decimales (productos a granel).
 * - El impuesto se calcula por línea y los totales son la suma de las líneas.
 * - Redondeo bancario (mitad al par) al centavo.
 */

/** Redondeo mitad al par, tolerante al ruido de punto flotante. */
export function roundHalfEven(x: number): number {
  const clean = Math.round(x * 1e6) / 1e6;
  const floor = Math.floor(clean);
  const diff = Math.round((clean - floor) * 1e6) / 1e6;
  const r = diff > 0.5 ? floor + 1 : diff < 0.5 ? floor : floor % 2 === 0 ? floor : floor + 1;
  return r === 0 ? 0 : r; // evita -0
}

/** Normaliza una cantidad a 3 decimales. */
export function normalizeQty(q: number): number {
  return Math.round(q * 1000) / 1000;
}

export type LineInput = {
  /** Precio unitario en centavos (con impuesto si taxIncluded). */
  unitPrice: number;
  quantity: number;
  /** Descuento total de la línea en centavos (en la misma base que el precio). */
  discount?: number;
  /** Tasa decimal: 0.16 = 16 %. */
  taxRate: number;
  taxIncluded: boolean;
};

export type LineAmounts = {
  gross: number;
  discount: number;
  net: number;
  tax: number;
  total: number;
};

export function computeLine(l: LineInput): LineAmounts {
  const qty = normalizeQty(l.quantity);
  const gross = roundHalfEven(l.unitPrice * qty);
  const discount = Math.min(Math.max(0, Math.round(l.discount ?? 0)), gross);
  const base = gross - discount;
  if (l.taxIncluded) {
    const net = roundHalfEven(base / (1 + l.taxRate));
    return { gross, discount, net, tax: base - net, total: base };
  }
  const tax = roundHalfEven(base * l.taxRate);
  return { gross, discount, net: base, tax, total: base + tax };
}

export type Totals = { subtotal: number; discount: number; tax: number; total: number; items: number };

export function computeTotals(lines: Array<LineInput & { amounts?: LineAmounts }>): Totals {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  let total = 0;
  let items = 0;
  for (const l of lines) {
    const a = l.amounts ?? computeLine(l);
    subtotal += a.net;
    discount += a.discount;
    tax += a.tax;
    total += a.total;
    items += normalizeQty(l.quantity);
  }
  return { subtotal, discount, tax, total, items: normalizeQty(items) };
}

/** Convierte texto de usuario ("1,250.50", "$99") a centavos. Devuelve null si no es válido. */
export function parseMoney(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? Math.round(input * 100) : null;
  const clean = input.replace(/[$\s,]/g, "").trim();
  if (clean === "") return null;
  if (!/^-?\d+(\.\d{0,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** Centavos → texto decimal editable ("1250.50"). */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2);
}

/** Centavos → "$1,250.50". */
export function formatCents(cents: number | null | undefined, currency = "MXN", locale = "es-MX"): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

export function formatQty(q: number | string): string {
  const n = typeof q === "string" ? Number(q) : q;
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/** Denominaciones de efectivo en México (centavos), de mayor a menor. */
export const MXN_DENOMINATIONS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50] as const;
