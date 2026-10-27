import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { getPurchaseOrder } from "@/server/modules/purchasing/service";
import { normalizeQty } from "@/lib/money";
import { ReceiveForm } from "./receive-form";

export const metadata: Metadata = { title: "Recibir mercancía" };

export default async function ReceivePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("purchases.receive");
  const { id } = await params;
  let d;
  try {
    d = await getPurchaseOrder(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  if (d.po.status !== "sent" && d.po.status !== "partial") redirect(`/compras/${id}`);
  const lines = d.lines
    .map((l) => ({ l, pending: normalizeQty(l.quantityOrdered - l.quantityReceived) }))
    .filter((x) => x.pending > 0)
    .map(({ l, pending }) => ({ lineId: l.id, variantId: l.variantId, label: `${l.name}${l.variantName ? ` · ${l.variantName}` : ""}`, sku: l.sku, pending, quantity: String(pending), unitCost: (l.unitCost / 100).toFixed(2), taxRate: l.taxRate }));
  return (
    <>
      <PageHeader title={`Recibir ${d.po.folio}`} description={`${d.supplier.name} → ${d.warehouse?.name}. La mercancía entra al inventario con su costo más la parte proporcional de flete y otros cargos.`} />
      <ReceiveForm orderId={id} folio={d.po.folio} lines={lines} currency={ctx.company?.currency ?? "MXN"} supplierTerms={d.supplier.paymentTermsDays} />
    </>
  );
}
