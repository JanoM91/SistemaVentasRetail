import type { Metadata } from "next";
import { Alert, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { canSeeCosts, getReceipt } from "@/server/modules/purchasing/service";
import { purchaseFormOptions } from "../../data";
import { SupplierReturnForm } from "./return-form";

export const metadata: Metadata = { title: "Devolución a proveedor" };

export default async function NewSupplierReturnPage({ searchParams }: { searchParams: Promise<{ recepcion?: string }> }) {
  const ctx = await requirePagePermission("purchases.return");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const q = await searchParams;
  const { suppliers, warehouses } = await purchaseFormOptions(ctx);
  if (!warehouses.length) return <Alert tone="warning">No tienes almacenes disponibles.</Alert>;
  const receipt = q.recepcion ? await getReceipt(ctx, q.recepcion).catch(() => null) : null;
  const def = warehouses.find((w) => w.id === receipt?.r.warehouseId) ?? warehouses.find((w) => w.branchId === ctx.branch?.id && w.isDefault) ?? warehouses[0];
  return (
    <>
      <PageHeader title="Devolución a proveedor" description="La mercancía sale del inventario a su costo y el importe con IVA se abona a las cuentas por pagar del proveedor." />
      <SupplierReturnForm
        suppliers={suppliers}
        warehouses={warehouses}
        currency={ctx.company.currency}
        canCost={canSeeCosts(ctx)}
        initial={{
          supplierId: receipt?.r.supplierId ?? "",
          warehouseId: def.id,
          receiptId: receipt?.r.id ?? "",
          receiptFolio: receipt?.r.folio ?? null,
          lines: (receipt?.lines ?? []).map((l) => ({ key: l.l.id, variant: { id: l.l.variantId, sku: l.sku, name: l.name, variantName: l.variantName, price: 0, trackStock: true }, quantity: String(Number(l.l.quantity)), unitCost: "" })),
        }}
      />
    </>
  );
}
