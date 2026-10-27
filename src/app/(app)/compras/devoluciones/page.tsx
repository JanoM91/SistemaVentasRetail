import type { Metadata } from "next";
import { Alert, ButtonLink, EmptyState, PageHeader, Table } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { listSupplierReturns } from "@/server/modules/purchasing/service";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { ComprasTabs } from "../tabs";

export const metadata: Metadata = { title: "Devoluciones a proveedor" };

export default async function SupplierReturnsPage() {
  const ctx = await requirePagePermission("purchases.view");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const rows = await listSupplierReturns(ctx);
  const cur = ctx.company.currency;
  const can = hasPermission(ctx, "purchases.return");
  return (
    <>
      <PageHeader title="Devoluciones a proveedor" actions={can && <ButtonLink href="/compras/devoluciones/nueva">Nueva devolución</ButtonLink>} />
      <ComprasTabs ctx={ctx} active="/compras/devoluciones" />
      {rows.length === 0 ? (
        <EmptyState title="Sin devoluciones" description="Registra aquí la mercancía que regresas al proveedor (dañada, caducada o mal surtida)." />
      ) : (
        <Table>
          <thead><tr><th>Folio</th><th>Proveedor</th><th className="hidden sm:table-cell">Fecha</th><th className="hidden md:table-cell">Motivo</th><th className="text-right">Crédito</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.r.id}>
                <td className="font-mono font-medium">{r.r.folio}</td>
                <td>{r.supplierName}</td>
                <td className="hidden sm:table-cell text-muted">{formatDate(r.r.createdAt)}</td>
                <td className="hidden md:table-cell text-muted">{r.r.reason}</td>
                <td className="text-right font-medium">{formatCents(r.r.creditAmount, cur)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
