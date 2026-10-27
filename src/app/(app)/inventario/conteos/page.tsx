import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, ButtonLink, EmptyState, PageHeader, Table } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { listCounts } from "@/server/modules/inventory/operations";
import { formatDateTime } from "@/lib/format";
import { InventarioTabs } from "../tabs";
import { COUNT_STATUS } from "../traspasos/status";

export const metadata: Metadata = { title: "Conteos físicos" };

export default async function CountsPage() {
  const ctx = await requirePagePermission("inventory.view");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const rows = await listCounts(ctx);
  return (
    <>
      <PageHeader title="Inventario" description="Conteos físicos: captura lo que hay en anaquel y aplica las diferencias como ajuste." actions={hasPermission(ctx, "inventory.count") && <ButtonLink href="/inventario/conteos/nuevo">Nuevo conteo</ButtonLink>} />
      <InventarioTabs active="/inventario/conteos" />
      {rows.length === 0 ? (
        <EmptyState title="Sin conteos" description="Haz un conteo completo o por categoría para corregir existencias." />
      ) : (
        <Table>
          <thead><tr><th>Folio</th><th>Almacén</th><th className="hidden sm:table-cell">Iniciado</th><th className="text-right">Avance</th><th>Estado</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.c.id}>
                <td><Link className="link font-mono font-medium" href={`/inventario/conteos/${r.c.id}`}>{r.c.folio}</Link></td>
                <td>{r.branchName} · {r.warehouseName}</td>
                <td className="hidden sm:table-cell text-muted">{formatDateTime(r.c.createdAt)}</td>
                <td className="text-right">{r.counted} / {r.total}</td>
                <td><Badge tone={COUNT_STATUS[r.c.status].tone}>{COUNT_STATUS[r.c.status].label}</Badge></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
