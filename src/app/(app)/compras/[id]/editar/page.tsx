import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Alert, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { getPurchaseOrder } from "@/server/modules/purchasing/service";
import { purchaseFormOptions } from "../../data";
import { PurchaseForm } from "../../purchase-form";

export const metadata: Metadata = { title: "Editar orden de compra" };

export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("purchases.create");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const { id } = await params;
  let d;
  try {
    d = await getPurchaseOrder(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  if (d.po.status !== "draft") redirect(`/compras/${id}`);
  const { suppliers, warehouses } = await purchaseFormOptions(ctx);
  return (
    <>
      <PageHeader title={`Editar ${d.po.folio}`} description="Solo los borradores se pueden editar." />
      <PurchaseForm
        mode="order"
        orderId={id}
        suppliers={suppliers}
        warehouses={warehouses}
        currency={ctx.company.currency}
        initial={{
          supplierId: d.po.supplierId,
          warehouseId: d.po.warehouseId,
          expectedAt: d.po.expectedAt ?? "",
          notes: d.po.notes ?? "",
          lines: d.lines.map((l) => ({ key: l.id, variant: { id: l.variantId, sku: l.sku, name: l.name, variantName: l.variantName, price: 0, trackStock: true }, quantity: String(l.quantityOrdered), unitCost: (l.unitCost / 100).toFixed(2) })),
        }}
      />
    </>
  );
}
