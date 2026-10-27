import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Description, PageHeader, Table } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { requirePagePermission } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { getReturn, REASON_LABELS, REFUND_LABELS } from "@/server/modules/returns/service";
import { formatCents, formatQty } from "@/lib/money";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Devolución" };

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("returns.create");
  const { id } = await params;
  let d;
  try {
    d = await getReturn(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const r = d.r;
  const cur = ctx.company?.currency ?? "MXN";
  return (
    <>
      <PageHeader
        title={`Devolución ${r.folio}`}
        description={<>{formatDateTime(r.createdAt)} · {d.branchName} · {d.userName} {r.saleId ? null : <Badge>Sin ticket</Badge>}</>}
        actions={<PrintButton />}
      />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card title="Productos devueltos">
          <Table className="border-0">
            <thead><tr><th>Producto</th><th className="text-right">Cant.</th><th>Destino</th><th className="text-right">Importe</th></tr></thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.description}<span className="block font-mono text-xs text-muted">{l.sku}</span></td>
                  <td className="text-right">{formatQty(l.quantity)}</td>
                  <td>{l.restock ? <Badge tone="success">Inventario</Badge> : <Badge tone="warning">Merma</Badge>}</td>
                  <td className="text-right">{formatCents(l.lineTotal, cur)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={3} className="text-right text-muted">Impuestos incluidos</td><td className="text-right">{formatCents(r.taxTotal, cur)}</td></tr>
              <tr><td colSpan={3} className="text-right font-semibold">Total devuelto</td><td className="text-right font-semibold">{formatCents(r.total, cur)}</td></tr>
            </tfoot>
          </Table>
        </Card>
        <div className="space-y-6">
          <Card title="Datos">
            <Description
              items={[
                { label: "Venta original", value: r.saleId ? <Link className="link font-mono" href={`/ventas/${r.saleId}`}>{d.saleFolio}</Link> : "Sin ticket" },
                { label: "Cliente", value: r.customerId ? <Link className="link" href={`/clientes/${r.customerId}`}>{d.customerName}</Link> : null },
                { label: "Motivo", value: `${REASON_LABELS[r.reasonCode]} · ${r.reason}` },
                { label: "Reembolso", value: <>{REFUND_LABELS[r.refundMethod]}{d.refundMethodName && ` · ${d.refundMethodName}`}{r.refundReference && ` · ${r.refundReference}`}</> },
                { label: "Autorizó", value: d.authorizerName },
                ...(d.showCost && r.costTotal !== null ? [{ label: "Costo de lo devuelto", value: formatCents(r.costTotal, cur) }] : []),
              ]}
            />
          </Card>
          {r.refundMethod === "store_credit" && (
            <Card title={`Vale ${r.folio}`}>
              <p className="text-sm">Saldo disponible: <b>{formatCents(r.storeCreditBalance, cur)}</b> de {formatCents(r.total, cur)}</p>
              {d.redemptions.length > 0 && (
                <ul className="mt-3 divide-y divide-border text-sm">
                  {d.redemptions.map(({ x, saleFolio }) => (
                    <li key={x.id} className="flex justify-between py-2">
                      <span><Link className="link font-mono" href={`/ventas/${x.saleId}`}>{saleFolio}</Link> · {formatDateTime(x.createdAt)} {x.status === "reversed" && <Badge>Revertido</Badge>}</span>
                      <span>−{formatCents(x.amount, cur)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
