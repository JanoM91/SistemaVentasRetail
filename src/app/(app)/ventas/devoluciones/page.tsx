import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, ButtonLink, EmptyState, PageHeader, Stat, Table } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { listReturns, REASON_LABELS, REFUND_LABELS } from "@/server/modules/returns/service";
import { formatCents } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { VentasTabs } from "../tabs";

export const metadata: Metadata = { title: "Devoluciones" };

export default async function ReturnsPage() {
  const ctx = await requirePagePermission("returns.create");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const rows = await listReturns(ctx);
  const cur = ctx.company.currency;
  const total = rows.reduce((a, r) => a + r.r.total, 0);
  const openVouchers = rows.filter((r) => r.r.refundMethod === "store_credit" && r.r.storeCreditBalance > 0);
  return (
    <>
      <PageHeader title="Ventas" description="Devoluciones y cambios. Se registran en el punto de venta con el folio del ticket." actions={<ButtonLink href="/pos">Ir al punto de venta</ButtonLink>} />
      <VentasTabs ctx={ctx} active="/ventas/devoluciones" />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Devoluciones" value={rows.length} hint="últimas 200" />
        <Stat label="Importe devuelto" value={formatCents(total, cur)} />
        <Stat label="Vales con saldo" value={openVouchers.length} hint={formatCents(openVouchers.reduce((a, r) => a + r.r.storeCreditBalance, 0), cur)} />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Sin devoluciones" description="En el punto de venta usa «Devolución» y captura el folio del ticket." />
      ) : (
        <Table>
          <thead>
            <tr><th>Folio</th><th>Fecha</th><th className="hidden sm:table-cell">Venta</th><th className="hidden md:table-cell">Motivo</th><th>Reembolso</th><th className="text-right">Importe</th></tr>
          </thead>
          <tbody>
            {rows.map(({ r, saleFolio, customerName }) => (
              <tr key={r.id}>
                <td><Link className="link font-mono font-medium" href={`/ventas/devoluciones/${r.id}`}>{r.folio}</Link></td>
                <td className="text-muted">{formatDateTime(r.createdAt)}</td>
                <td className="hidden sm:table-cell">{saleFolio ? <Link className="link font-mono" href={`/ventas/${r.saleId}`}>{saleFolio}</Link> : <Badge>Sin ticket</Badge>}{customerName && <span className="block text-xs text-muted">{customerName}</span>}</td>
                <td className="hidden md:table-cell text-muted">{REASON_LABELS[r.reasonCode]}</td>
                <td>{REFUND_LABELS[r.refundMethod]}{r.refundMethod === "store_credit" && <span className="block text-xs text-muted">saldo {formatCents(r.storeCreditBalance, cur)}</span>}</td>
                <td className="text-right font-medium">{formatCents(r.total, cur)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
