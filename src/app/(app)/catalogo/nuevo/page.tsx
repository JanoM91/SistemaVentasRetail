import type { Metadata } from "next";
import { Alert, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { listCatalogOptions } from "@/server/modules/catalog/service";
import { ProductCreateForm } from "../product-form";

export const metadata: Metadata = { title: "Nuevo producto" };

export default async function NewProductPage() {
  const ctx = await requirePagePermission("catalog.create");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const opts = await listCatalogOptions(ctx);
  return (
    <>
      <PageHeader title="Nuevo producto" description="Los precios se capturan con impuesto incluido. La existencia inicial entra al almacén principal de la sucursal activa." />
      <ProductCreateForm
        categories={opts.categories}
        brands={opts.brands}
        units={opts.units.map((u) => ({ id: u.id, code: u.code, name: u.name, allowsDecimals: u.allowsDecimals }))}
        taxes={opts.taxes.map((t) => ({ id: t.id, code: t.code, name: t.name, isDefault: t.isDefault }))}
        canCost={hasPermission(ctx, "catalog.view_cost")}
        canStock={hasPermission(ctx, "inventory.adjust")}
        branchName={ctx.branch?.name ?? null}
      />
    </>
  );
}
