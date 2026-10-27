import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { NotFoundError } from "@/server/errors";
import { getPriceList } from "@/server/modules/promotions/service";
import { PriceItemsEditor, PriceListForm } from "../price-list-forms";

export const metadata: Metadata = { title: "Lista de precios" };

export default async function PriceListPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("promotions.view");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const { id } = await params;
  let d;
  try {
    d = await getPriceList(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const canManage = hasPermission(ctx, "promotions.manage");
  return (
    <>
      <PageHeader title={d.list.name} description="Precio fijo por producto; los demás usan el ajuste general." />
      <div className="mb-6">
        {d.groups.length ? (
          <Alert tone="info">Se aplica a los clientes de: {d.groups.map((g) => g.name).join(", ")}.</Alert>
        ) : (
          <Alert tone="warning" title="Aún no se aplica a nadie">Asígnala a un grupo en <Link className="link" href="/clientes/grupos">Clientes → Grupos</Link>.</Alert>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.6fr]">
        <Card title="Datos">{canManage ? <PriceListForm list={d.list} /> : <p className="text-sm">{d.list.adjustmentPercent ? `${Number(d.list.adjustmentPercent)} %` : "Sin ajuste"}</p>}</Card>
        <Card title="Precios fijos">
          {canManage ? (
            <PriceItemsEditor
              listId={id}
              currency={ctx.company.currency}
              initial={d.items.map((r) => ({ variantId: r.i.variantId, label: `${r.name}${r.variantName ? ` · ${r.variantName}` : ""}`, sku: r.sku, basePrice: r.basePrice, price: (r.i.price / 100).toFixed(2) }))}
            />
          ) : (
            <p className="text-sm text-muted">{d.items.length} precio(s) fijo(s).</p>
          )}
        </Card>
      </div>
    </>
  );
}
