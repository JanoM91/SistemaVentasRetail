import { describe, expect, it } from "vitest";
import { computeLine, computeTotals, formatQty, parseMoney, roundHalfEven } from "@/lib/money";

describe("redondeo bancario", () => {
  it("redondea la mitad al par", () => {
    expect(roundHalfEven(2.5)).toBe(2);
    expect(roundHalfEven(3.5)).toBe(4);
    expect(roundHalfEven(2.4999)).toBe(2);
    expect(roundHalfEven(2.5001)).toBe(3);
    expect(roundHalfEven(-0.4)).toBe(0);
    expect(roundHalfEven(-2.5)).toBe(-2);
  });
  it("tolera ruido de punto flotante", () => {
    expect(roundHalfEven(0.1 * 3 * 100)).toBe(30);
    expect(roundHalfEven(1.005 * 100)).toBe(100); // 100.49999… → 100.5 limpio → par
  });
});

describe("cálculo por línea", () => {
  it("IVA incluido en el precio: separa base e impuesto sin perder centavos", () => {
    const a = computeLine({ unitPrice: 11600, quantity: 1, taxRate: 0.16, taxIncluded: true });
    expect(a).toEqual({ gross: 11600, discount: 0, net: 10000, tax: 1600, total: 11600 });
  });
  it("IVA incluido con importe que no divide exacto", () => {
    const a = computeLine({ unitPrice: 1999, quantity: 3, taxRate: 0.16, taxIncluded: true });
    expect(a.total).toBe(5997);
    expect(a.net + a.tax).toBe(5997);
    expect(a.net).toBe(5170); // 5997 / 1.16 = 5169.83 → 5170
  });
  it("precio sin impuesto: suma el impuesto", () => {
    const a = computeLine({ unitPrice: 10000, quantity: 2, taxRate: 0.08, taxIncluded: false });
    expect(a).toEqual({ gross: 20000, discount: 0, net: 20000, tax: 1600, total: 21600 });
  });
  it("granel con 3 decimales", () => {
    const a = computeLine({ unitPrice: 4590, quantity: 0.755, taxRate: 0, taxIncluded: true });
    expect(a.total).toBe(3465); // 3465.45 → 3465
  });
  it("descuento se aplica antes del impuesto y no excede el bruto", () => {
    const a = computeLine({ unitPrice: 11600, quantity: 1, discount: 1160, taxRate: 0.16, taxIncluded: true });
    expect(a.total).toBe(10440);
    expect(a.net).toBe(9000);
    const b = computeLine({ unitPrice: 1000, quantity: 1, discount: 5000, taxRate: 0.16, taxIncluded: true });
    expect(b.total).toBe(0);
  });
  it("los totales son la suma de las líneas", () => {
    const t = computeTotals([
      { unitPrice: 1999, quantity: 3, taxRate: 0.16, taxIncluded: true },
      { unitPrice: 4590, quantity: 0.755, taxRate: 0, taxIncluded: true },
    ]);
    expect(t.total).toBe(5997 + 3465);
    expect(t.subtotal + t.tax).toBe(t.total);
    expect(t.items).toBe(3.755);
  });
});

describe("captura de importes", () => {
  it("convierte texto a centavos", () => {
    expect(parseMoney("1,250.50")).toBe(125050);
    expect(parseMoney("$99")).toBe(9900);
    expect(parseMoney("0.1")).toBe(10);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("12.345")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
  });
  it("formatea cantidades", () => {
    expect(formatQty(2)).toBe("2");
    expect(formatQty("0.750")).toBe("0.75");
  });
});
