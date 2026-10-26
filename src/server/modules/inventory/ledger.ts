import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { inventoryLedger, stockBalances, type MovementType } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { normalizeQty, roundHalfEven } from "@/lib/money";

export type PostMovementInput = {
  tenantId: string;
  companyId: string;
  branchId: string;
  warehouseId: string;
  variantId: string;
  movementType: MovementType;
  /** Con signo: positivo entra, negativo sale. */
  quantity: number;
  /**
   * Costo unitario (centavos). En entradas: el costo de lo que entra (nulo = se
   * usa el promedio vigente). En salidas se ignora y se usa el promedio vigente,
   * salvo que `forceUnitCost` sea true (reversos y cancelaciones).
   */
  unitCost?: number | null;
  forceUnitCost?: boolean;
  allowNegative: boolean;
  referenceType?: string | null;
  referenceId?: string | null;
  reversesId?: string | null;
  reason?: string | null;
  createdBy: string | null;
  /** Etiqueta para el mensaje de error de existencia insuficiente. */
  label?: string;
};

export class InsufficientStockError extends DomainError {
  readonly variantId: string;
  readonly available: number;
  readonly requested: number;
  constructor(variantId: string, available: number, requested: number, label?: string) {
    super(
      "insufficient_stock",
      `Existencia insuficiente${label ? ` de ${label}` : ""}: hay ${available}, se requieren ${requested}.`,
      409,
    );
    this.variantId = variantId;
    this.available = available;
    this.requested = requested;
  }
}

/**
 * Registra un movimiento en el libro y actualiza el saldo materializado en la
 * misma transacción. Bloquea la fila de saldo para serializar movimientos
 * concurrentes sobre la misma variante y almacén.
 *
 * Costo promedio ponderado:
 *   entrada con costo c sobre existencia e>0 con promedio p:  p' = (e·p + q·c) / (e + q)
 *   entrada con existencia ≤ 0 o sin promedio previo:          p' = c
 *   salida:                                                    se valúa a p; p' = p
 */
export async function postMovement(tx: DbOrTx, m: PostMovementInput) {
  const q = normalizeQty(m.quantity);
  if (q === 0) throw new DomainError("invalid_quantity", "La cantidad no puede ser cero.");

  await tx
    .insert(stockBalances)
    .values({
      tenantId: m.tenantId,
      companyId: m.companyId,
      branchId: m.branchId,
      warehouseId: m.warehouseId,
      variantId: m.variantId,
      onHand: "0",
    })
    .onConflictDoNothing();

  const [bal] = await tx
    .select()
    .from(stockBalances)
    .where(and(eq(stockBalances.warehouseId, m.warehouseId), eq(stockBalances.variantId, m.variantId)))
    .for("update");

  const onHand = Number(bal.onHand);
  const avg = bal.avgCost;
  const newOnHand = normalizeQty(onHand + q);

  if (q < 0 && newOnHand < 0 && !m.allowNegative) {
    throw new InsufficientStockError(m.variantId, onHand, -q, m.label);
  }

  let unitCost: number | null;
  let newAvg: number | null;
  if (q > 0) {
    const incoming = m.unitCost ?? avg ?? null;
    unitCost = incoming;
    if (incoming === null) newAvg = avg;
    else if (onHand <= 0 || avg === null) newAvg = incoming;
    else newAvg = roundHalfEven((onHand * avg + q * incoming) / (onHand + q));
  } else {
    unitCost = m.forceUnitCost ? (m.unitCost ?? null) : avg;
    newAvg = avg;
  }
  const totalCost = unitCost === null ? null : roundHalfEven(unitCost * Math.abs(q)) * Math.sign(q);

  const [row] = await tx
    .insert(inventoryLedger)
    .values({
      tenantId: m.tenantId,
      companyId: m.companyId,
      branchId: m.branchId,
      warehouseId: m.warehouseId,
      variantId: m.variantId,
      movementType: m.movementType,
      quantity: String(q),
      unitCost,
      totalCost,
      balanceAfter: String(newOnHand),
      avgCostAfter: newAvg,
      referenceType: m.referenceType ?? null,
      referenceId: m.referenceId ?? null,
      reversesId: m.reversesId ?? null,
      reason: m.reason ?? null,
      createdBy: m.createdBy,
    })
    .returning();

  await tx
    .update(stockBalances)
    .set({ onHand: String(newOnHand), avgCost: newAvg, lastMovementAt: row.createdAt, updatedAt: sql`now()` })
    .where(and(eq(stockBalances.warehouseId, m.warehouseId), eq(stockBalances.variantId, m.variantId)));

  return { ledger: row, onHand: newOnHand, avgCost: newAvg, unitCost };
}

/** Tipos que solo suman, solo restan o pueden ir en ambos sentidos. */
export const INBOUND_TYPES: readonly MovementType[] = ["opening", "purchase_in", "adjustment_in", "sale_cancel_in", "return_in", "transfer_in"];
export const OUTBOUND_TYPES: readonly MovementType[] = ["adjustment_out", "shrinkage", "damaged", "expired", "sale_out", "transfer_out"];

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  opening: "Existencia inicial",
  purchase_in: "Compra",
  adjustment_in: "Ajuste (entrada)",
  adjustment_out: "Ajuste (salida)",
  shrinkage: "Merma",
  damaged: "Dañado",
  expired: "Caducado",
  sale_out: "Venta",
  sale_cancel_in: "Cancelación de venta",
  return_in: "Devolución de cliente",
  transfer_out: "Traspaso (salida)",
  transfer_in: "Traspaso (entrada)",
  count_adjustment: "Ajuste por conteo",
  reversal: "Corrección (reverso)",
};
