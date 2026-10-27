import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { documentSequences, type DocumentType } from "@/server/db/schema";

/** Serie por defecto de cada documento. */
export const DEFAULT_SERIES: Record<DocumentType, string> = {
  sale: "V",
  quote: "C",
  return: "D",
  purchase: "OC",
  receipt: "RC",
  supplier_return: "DP",
  transfer: "TR",
  count: "CF",
  invoice: "F",
  customer_payment: "AB",
  customer: "CL",
};

/**
 * Toma el siguiente folio de un documento (bloquea la fila de la serie hasta
 * que termine la transacción). `branchId` nulo = serie de toda la empresa.
 */
export async function nextFolio(
  tx: DbOrTx,
  input: { tenantId: string; companyId: string; branchId: string | null; documentType: DocumentType },
) {
  await tx
    .insert(documentSequences)
    .values({ tenantId: input.tenantId, companyId: input.companyId, branchId: input.branchId, documentType: input.documentType, series: DEFAULT_SERIES[input.documentType] })
    .onConflictDoNothing();
  const [seq] = await tx
    .select()
    .from(documentSequences)
    .where(
      and(
        eq(documentSequences.companyId, input.companyId),
        input.branchId ? eq(documentSequences.branchId, input.branchId) : sql`${documentSequences.branchId} is null`,
        sql`${documentSequences.cashRegisterId} is null`,
        eq(documentSequences.documentType, input.documentType),
      ),
    )
    .orderBy(documentSequences.createdAt)
    .limit(1)
    .for("update");
  await tx.update(documentSequences).set({ nextNumber: seq.nextNumber + 1, updatedAt: new Date() }).where(eq(documentSequences.id, seq.id));
  return { series: seq.series, number: seq.nextNumber, folio: `${seq.series}-${String(seq.nextNumber).padStart(seq.padding, "0")}` };
}
