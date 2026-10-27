import type { Metadata } from "next";
import { Alert, ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { purchaseFormOptions } from "../data";
import { PurchaseForm } from "../purchase-form";

export const metadata: Metadata = { title: "Nueva orden de compra" };

export default async function NewOrderPage() {
  const ctx = await requirePagePermission("purchases.create");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const { suppliers, warehouses } = await purchaseFormOptions(ctx);
  if (!suppliers.length) return <EmptyState title="Primero da de alta un proveedor" action={<ButtonLink href="/compras/proveedores/nuevo">Nuevo proveedor</ButtonLink>} />;
  if (!warehouses.length) return <Alert tone="warning">No tienes almacenes disponibles.</Alert>;
  const def = warehouses.find((w) => w.branchId === ctx.branch?.id && w.isDefault) ?? warehouses[0];
  return (
    <>
      <PageHeader title="Nueva orden de compra" description="Se guarda como borrador. Al enviarla (autorizarla) ya no se edita y queda lista para recibirse." />
      <PurchaseForm mode="order" suppliers={suppliers} warehouses={warehouses} currency={ctx.company.currency} initial={{ supplierId: "", warehouseId: def.id, expectedAt: "", notes: "", lines: [] }} />
    </>
  );
}
