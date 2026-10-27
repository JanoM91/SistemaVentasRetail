import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, Card, EmptyState, PageHeader, Table } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { listPriceLists } from "@/server/modules/promotions/service";
import { PromocionesTabs } from "../tabs";
import { PriceListForm } from "./price-list-forms";

export const metadata: Metadata = { title: "Listas de precios" };

export default async function PriceListsPage() {
  const ctx = await requirePagePermission("promotions.view");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const rows = await listPriceLists(ctx);
  return (
    <>
      <PageHeader title="Promociones" description="Listas de precios por grupo de clientes (mayoreo, empleados…). Se asignan en Clientes → Grupos." />
      <PromocionesTabs active="/promociones/listas" />
      {hasPermission(ctx, "promotions.manage") && <Card title="Nueva lista" className="mb-6"><PriceListForm /></Card>}
      {rows.length === 0 ? (
        <EmptyState title="Sin listas de precios" />
      ) : (
        <Table>
          <thead><tr><th>Lista</th><th>Ajuste general</th><th className="text-right">Precios fijos</th><th>Grupos</th><th>Estado</th></tr></thead>
          <tbody>
            {rows.map(({ l, items, groups }) => (
              <tr key={l.id}>
                <td><Link className="link font-medium" href={`/promociones/listas/${l.id}`}>{l.name}</Link></td>
                <td>{l.adjustmentPercent ? `${Number(l.adjustmentPercent)} %` : "—"}</td>
                <td className="text-right">{items}</td>
                <td className="text-muted">{groups ?? <span className="text-warning">Sin asignar</span>}</td>
                <td>{l.isActive ? <Badge tone="success">Activa</Badge> : <Badge>Inactiva</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
