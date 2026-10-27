import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, ButtonLink, EmptyState, PageHeader, Table } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { listReceipts } from "@/server/modules/purchasing/service";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { ComprasTabs } from "../tabs";

export const metadata: Metadata = { title: "Recepciones" };

export default async function ReceiptsPage() {
  const ctx = await requirePagePermission("purchases.view");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const rows = await listReceipts(ctx);
  const cur = ctx.company.currency;
  return (
    <>
      <PageHeader title="Recepciones" description="Cada entrada de mercancía de proveedor: de una orden o compra directa." actions={hasPermission(ctx, "purchases.receive") && <ButtonLink href="/compras/directa">Compra directa</ButtonLink>} />
      <ComprasTabs ctx={ctx} active="/compras/recepciones" />
      {rows.length === 0 ? (
        <EmptyState title="Aún no hay recepciones" description="Se generan al recibir una orden enviada o registrar una compra directa." />
      ) : (
        <Table>
          <thead>
            <tr><th>Folio</th><th>Proveedor</th><th className="hidden sm:table-cell">Fecha</th><th className="hidden md:table-cell">Factura</th><th className="hidden md:table-cell">Orden</th><th className="text-right">Total</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.r.id}>
                <td><Link className="link font-mono font-medium" href={`/compras/recepciones/${r.r.id}`}>{r.r.folio}</Link></td>
                <td>{r.supplierName}</td>
                <td className="hidden sm:table-cell text-muted">{formatDate(r.r.receivedAt)}</td>
                <td className="hidden md:table-cell text-muted">{r.r.supplierInvoice ?? "—"}</td>
                <td className="hidden md:table-cell">{r.orderFolio ? <span className="font-mono">{r.orderFolio}</span> : <Badge>Directa</Badge>}</td>
                <td className="text-right font-medium">{formatCents(r.r.total, cur)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
