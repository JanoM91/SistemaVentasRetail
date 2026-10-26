import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { TenantCreateForm } from "../forms";

export const metadata: Metadata = { title: "Nueva cuenta" };

export default async function NewTenantPage() {
  await requirePagePermission("platform.tenants.manage");
  return (
    <>
      <PageHeader title="Nueva cuenta" description="Se crea el negocio con su primera empresa, sucursal, almacén, caja y usuario dueño." />
      <TenantCreateForm />
    </>
  );
}
