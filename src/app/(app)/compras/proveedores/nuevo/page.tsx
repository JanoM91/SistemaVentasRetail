import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { SupplierForm } from "../supplier-form";

export const metadata: Metadata = { title: "Nuevo proveedor" };

export default async function NewSupplierPage() {
  await requirePagePermission("purchases.create");
  return (
    <>
      <PageHeader title="Nuevo proveedor" />
      <Card><SupplierForm /></Card>
    </>
  );
}
