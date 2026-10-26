import type { DbOrTx } from "@/server/db";
import { unitsOfMeasure } from "@/server/db/schema";

export const DEFAULT_UNITS = [
  { code: "PZA", name: "Pieza", allowsDecimals: false, satCode: "H87" },
  { code: "KG", name: "Kilogramo", allowsDecimals: true, satCode: "KGM" },
  { code: "G", name: "Gramo", allowsDecimals: true, satCode: "GRM" },
  { code: "LT", name: "Litro", allowsDecimals: true, satCode: "LTR" },
  { code: "ML", name: "Mililitro", allowsDecimals: true, satCode: "MLT" },
  { code: "M", name: "Metro", allowsDecimals: true, satCode: "MTR" },
  { code: "CAJA", name: "Caja", allowsDecimals: false, satCode: "XBX" },
  { code: "PAQ", name: "Paquete", allowsDecimals: false, satCode: "XPK" },
  { code: "SERV", name: "Servicio", allowsDecimals: false, satCode: "E48" },
] as const;

/** Crea las unidades de medida por defecto si faltan (idempotente). */
export async function ensureCatalogDefaults(conn: DbOrTx, tenantId: string, companyId: string, by: string | null) {
  await conn
    .insert(unitsOfMeasure)
    .values(DEFAULT_UNITS.map((u) => ({ ...u, tenantId, companyId, createdBy: by, updatedBy: by })))
    .onConflictDoNothing();
}

