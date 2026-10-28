import { describe, expect, it } from "vitest";
import { change, resolvePeriod, startOfLocalDay } from "@/lib/period";

const TZ = "America/Mexico_City";
const now = new Date("2026-10-27T18:00:00Z"); // martes 27-oct, 12:00 en CDMX

describe("periodos de reporte en la zona de la empresa", () => {
  it("el día local empieza a la medianoche de la zona", () => {
    expect(startOfLocalDay("2026-10-27", TZ).toISOString()).toBe("2026-10-27T06:00:00.000Z");
    expect(startOfLocalDay("2026-10-27", "America/Cancun").toISOString()).toBe("2026-10-27T05:00:00.000Z");
  });
  it("presets y periodo anterior equivalente", () => {
    const hoy = resolvePeriod(TZ, { preset: "hoy", now });
    expect([hoy.fromDay, hoy.toDay, hoy.days]).toEqual(["2026-10-27", "2026-10-27", 1]);
    expect(hoy.to.toISOString()).toBe("2026-10-28T06:00:00.000Z");
    expect(hoy.previous.fromDay).toBe("2026-10-26");
    const s = resolvePeriod(TZ, { preset: "7d", now });
    expect([s.fromDay, s.toDay, s.previous.fromDay, s.previous.toDay]).toEqual(["2026-10-21", "2026-10-27", "2026-10-14", "2026-10-20"]);
    const m = resolvePeriod(TZ, { preset: "mes-anterior", now });
    expect([m.fromDay, m.toDay, m.days]).toEqual(["2026-09-01", "2026-09-30", 30]);
    expect(resolvePeriod(TZ, { preset: "anio", now }).fromDay).toBe("2026-01-01");
  });
  it("rango personalizado y valores por defecto", () => {
    const p = resolvePeriod(TZ, { from: "2026-10-01", to: "2026-10-15", now });
    expect([p.preset, p.days]).toEqual(["personalizado", 15]);
    expect(resolvePeriod(TZ, { from: "2026-10-10", to: "2026-10-01", now }).toDay).toBe("2026-10-10");
    expect(resolvePeriod(TZ, { preset: "x", now }).preset).toBe("7d");
  });
  it("variación porcentual", () => {
    expect(change(120, 100)).toBe(20);
    expect(change(80, 100)).toBe(-20);
    expect(change(5, 0)).toBeNull();
  });
});
