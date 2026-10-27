import type { Metadata } from "next";
import { Alert, Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { listAccessibleWarehouses } from "@/server/modules/inventory/service";
import { listCatalogOptions } from "@/server/modules/catalog/service";
import { CountForm } from "./count-form";

export const metadata: Metadata = { title: "Nuevo conteo físico" };

export default async function NewCountPage() {
  const ctx = await requirePagePermission("inventory.count");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const [whs, opts] = await Promise.all([listAccessibleWarehouses(ctx), listCatalogOptions(ctx)]);
  if (!whs.length) return <Alert tone="warning">No tienes almacenes disponibles.</Alert>;
  const def = whs.find((w) => w.branchId === ctx.branch?.id && w.isDefault) ?? whs[0];
  return (
    <>
      <PageHeader title="Nuevo conteo físico" description="Se crea la lista de productos a contar. Puedes seguir vendiendo: la diferencia se calcula contra la existencia del momento en que capturas cada producto." />
      <Card><CountForm warehouses={whs.map((w) => ({ id: w.id, label: `${w.branchName} · ${w.name}` }))} categories={opts.categories} defaultWarehouseId={def.id} /></Card>
    </>
  );
}
