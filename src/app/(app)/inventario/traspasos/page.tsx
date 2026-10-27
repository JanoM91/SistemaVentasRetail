import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, ButtonLink, EmptyState, PageHeader, Table } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { listTransfers } from "@/server/modules/inventory/operations";
import { formatCents } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { InventarioTabs } from "../tabs";
import { TRANSFER_STATUS } from "./status";

export const metadata: Metadata = { title: "Traspasos" };

export default async function TransfersPage({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  const ctx = await requirePagePermission("inventory.view");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const q = await searchParams;
  const rows = await listTransfers(ctx, { status: q.estado || null });
  const cur = ctx.company.currency;
  const filters = [{ v: "", l: "Todos" }, { v: "in_transit", l: "En tránsito" }, { v: "received", l: "Recibidos" }, { v: "cancelled", l: "Cancelados" }];
  return (
    <>
      <PageHeader title="Inventario" description="Traspasos entre almacenes y sucursales." actions={hasPermission(ctx, "inventory.transfer") && <ButtonLink href="/inventario/traspasos/nuevo">Nuevo traspaso</ButtonLink>} />
      <InventarioTabs active="/inventario/traspasos" />
      <div className="mb-4 flex flex-wrap gap-2">
        {filters.map((f) => (
          <Link key={f.v} href={f.v ? `/inventario/traspasos?estado=${f.v}` : "/inventario/traspasos"} className={`rounded-full border px-3 py-1 text-sm ${(q.estado ?? "") === f.v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted"}`}>{f.l}</Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Sin traspasos" description="Mueve mercancía entre sucursales con control de lo que sale y lo que llega." />
      ) : (
        <Table>
          <thead><tr><th>Folio</th><th>Origen → destino</th><th className="hidden sm:table-cell">Enviado</th><th className="hidden md:table-cell text-right">Productos</th>{rows[0].value !== null && <th className="hidden md:table-cell text-right">Valor</th>}<th>Estado</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.t.id}>
                <td><Link className="link font-mono font-medium" href={`/inventario/traspasos/${r.t.id}`}>{r.t.folio}</Link></td>
                <td>{r.fromBranch} · {r.fromName} → {r.toBranch} · {r.toName}</td>
                <td className="hidden sm:table-cell text-muted">{formatDateTime(r.t.sentAt)}</td>
                <td className="hidden md:table-cell text-right">{r.lines}</td>
                {r.value !== null && <td className="hidden md:table-cell text-right">{formatCents(r.value, cur)}</td>}
                <td><Badge tone={TRANSFER_STATUS[r.t.status].tone}>{TRANSFER_STATUS[r.t.status].label}</Badge></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
