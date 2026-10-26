import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { BranchForm } from "../branch-form";
import { createBranchAction } from "../actions";

export const metadata: Metadata = { title: "Nueva sucursal" };

export default async function NewBranchPage() {
  await requirePagePermission("branches.manage");
  return (
    <>
      <PageHeader title="Nueva sucursal" description="Se creará con un almacén principal y una caja." />
      <Card><BranchForm action={createBranchAction} mode="create" /></Card>
    </>
  );
}
