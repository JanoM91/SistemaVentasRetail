import type { Metadata } from "next";
import { Alert, ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { purchaseFormOptions } from "../data";
import { PurchaseForm } from "../purchase-form";

export const metadata: Metadata = { title: "Compra directa" };

export default async function DirectPurchasePage() {
  const ctx = await requirePagePermission("purchases.receive");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const { suppliers, warehouses } = await purchaseFormOptions(ctx);
  if (!suppliers.length) return <EmptyState title="Primero da de alta un proveedor" action={<ButtonLink href="/compras/proveedores/nuevo">Nuevo proveedor</ButtonLink>} />;
  if (!warehouses.length) return <Alert tone="warning">No tienes almacenes disponibles.</Alert>;
  const def = warehouses.find((w) => w.branchId === ctx.branch?.id && w.isDefault) ?? warehouses[0];
  return (
    <>
      <PageHeader title="Compra directa" description="Para mercancía que llegó sin orden previa (p. ej. el repartidor del proveedor). Da entrada al inventario y crea la cuenta por pagar." />
      <PurchaseForm mode="direct" suppliers={suppliers} warehouses={warehouses} currency={ctx.company.currency} initial={{ supplierId: "", warehouseId: def.id, expectedAt: "", notes: "", lines: [] }} />
    </>
  );
}
