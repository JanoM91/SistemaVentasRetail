import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { listGroups } from "@/server/modules/customers/service";
import { listPriceLists } from "@/server/modules/promotions/service";
import { ClientesTabs } from "../tabs";
import { GroupForm } from "./group-form";

export const metadata: Metadata = { title: "Grupos de clientes" };

export default async function GroupsPage() {
  const ctx = await requirePagePermission("customers.view");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const groups = await listGroups(ctx);
  const lists = hasPermission(ctx, "promotions.view") ? (await listPriceLists(ctx)).filter((r) => r.l.isActive).map((r) => ({ id: r.l.id, name: r.l.name })) : [];
  const can = hasPermission(ctx, "customers.manage");
  return (
    <>
      <PageHeader title="Grupos de clientes" description="Agrupa clientes (mayoreo, empleados, frecuentes). En las listas de precios y promociones se podrán usar estos grupos." />
      <ClientesTabs ctx={ctx} active="/clientes/grupos" />
      {can && <Card title="Nuevo grupo" className="mb-6"><GroupForm priceLists={lists} /></Card>}
      {groups.length === 0 ? (
        <EmptyState title="Sin grupos" />
      ) : (
        <div className="space-y-3">
          {groups.map(({ g, members }) => (
            <Card key={g.id} title={<>{g.name} <Link className="link ml-2 text-sm font-normal" href={`/clientes?grupo=${g.id}`}>{members} cliente(s)</Link></>}>
              {can ? <GroupForm group={g} priceLists={lists} /> : <p className="text-sm text-muted">{g.description ?? "—"}</p>}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
