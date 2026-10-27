import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { listGroups } from "@/server/modules/customers/service";
import { CustomerForm } from "../customer-form";

export const metadata: Metadata = { title: "Nuevo cliente" };

export default async function NewCustomerPage() {
  const ctx = await requirePagePermission("customers.manage");
  const groups = await listGroups(ctx);
  return (
    <>
      <PageHeader title="Nuevo cliente" description="Solo el nombre es obligatorio. El teléfono ayuda a encontrarlo rápido en caja." />
      <Card><CustomerForm groups={groups.map((g) => ({ id: g.g.id, name: g.g.name }))} /></Card>
    </>
  );
}
