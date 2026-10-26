import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { CompanyForm } from "../company-form";
import { createCompanyAction } from "../actions";

export const metadata: Metadata = { title: "Nueva empresa" };

export default async function NewCompanyPage() {
  const ctx = await requirePagePermission("companies.manage");
  return (
    <>
      <PageHeader title="Nueva empresa" description="Se creará con una sucursal, un almacén, una caja, impuestos y métodos de pago por defecto. Tú quedarás como dueño." />
      <Card>
        <CompanyForm action={createCompanyAction} mode="create" values={{ currency: ctx.company?.currency, timezone: ctx.company?.timezone, locale: ctx.company?.locale }} />
      </Card>
    </>
  );
}
