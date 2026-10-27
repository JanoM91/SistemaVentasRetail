import type { Metadata } from "next";
import { Alert, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { listAccessibleWarehouses } from "@/server/modules/inventory/service";
import { listCompanyWarehouses } from "@/server/modules/inventory/operations";
import { TransferForm } from "./transfer-form";

export const metadata: Metadata = { title: "Nuevo traspaso" };

export default async function NewTransferPage() {
  const ctx = await requirePagePermission("inventory.transfer");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const [mine, all] = await Promise.all([listAccessibleWarehouses(ctx), listCompanyWarehouses(ctx)]);
  if (!mine.length) return <Alert tone="warning">No tienes almacenes de origen disponibles.</Alert>;
  if (all.length < 2) return <Alert tone="info">Se necesitan al menos dos almacenes para hacer traspasos. Agrégalos en Sucursales.</Alert>;
  const def = mine.find((w) => w.branchId === ctx.branch?.id && w.isDefault) ?? mine[0];
  return (
    <>
      <PageHeader title="Nuevo traspaso" description="La mercancía sale del origen al enviar y queda en tránsito hasta que el destino confirme lo que llegó." />
      <TransferForm
        origins={mine.map((w) => ({ id: w.id, label: `${w.branchName} · ${w.name}` }))}
        destinations={all.map((w) => ({ id: w.id, label: `${w.branchName} · ${w.name}` }))}
        defaultFrom={def.id}
        currency={ctx.company.currency}
      />
    </>
  );
}
