import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, ButtonLink, Card, Description, PageHeader, Table } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { NotFoundError } from "@/server/errors";
import { canSeeCosts, getPayablePayments, getReceipt } from "@/server/modules/purchasing/service";
import { formatCents, formatQty } from "@/lib/money";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Recepción" };

export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ nuevo?: string }> }) {
  const ctx = await requirePagePermission("purchases.view");
  const { id } = await params;
  const { nuevo } = await searchParams;
  let d;
  try {
    d = await getReceipt(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const cur = ctx.company?.currency ?? "MXN";
  const r = d.r;
  const payments = d.payable ? await getPayablePayments(ctx, d.payable.id) : [];
  const landed = canSeeCosts(ctx);
  const extras = (r.extraCostsDetail ?? []) as Array<{ concept: string; amount: number }>;
  return (
    <>
      <PageHeader
        title={`Recepción ${r.folio}`}
        description={<>{d.supplier.name} · {d.warehouseName} · {formatDateTime(r.receivedAt)} · {d.orderFolio ? <>orden <span className="font-mono">{d.orderFolio}</span></> : <Badge>Compra directa</Badge>}</>}
        actions={
          <>
            <PrintButton />
            {hasPermission(ctx, "purchases.return") && <ButtonLink variant="secondary" href={`/compras/devoluciones/nueva?recepcion=${r.id}`}>Devolver al proveedor</ButtonLink>}
          </>
        }
      />
      {nuevo && <div className="mb-4"><Alert tone="success" title="Mercancía recibida">Ya está en el inventario y se creó la cuenta por pagar.</Alert></div>}
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card title="Productos">
          <Table className="border-0">
            <thead>
              <tr><th>Producto</th><th className="text-right">Cantidad</th><th className="text-right">Costo</th>{landed && <th className="text-right" title="Costo con flete y cargos prorrateados">Costo final</th>}<th className="text-right">Importe</th></tr>
            </thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.l.id}>
                  <td><span className="block font-medium">{l.name}{l.variantName && ` · ${l.variantName}`}</span><span className="font-mono text-xs text-muted">{l.sku}</span></td>
                  <td className="text-right">{formatQty(l.l.quantity)}</td>
                  <td className="text-right">{formatCents(l.l.unitCost, cur)}</td>
                  {landed && <td className="text-right">{formatCents(l.l.landedUnitCost, cur)}</td>}
                  <td className="text-right">{formatCents(Math.round(Number(l.l.quantity) * l.l.unitCost), cur)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={landed ? 4 : 3} className="text-right text-muted">Mercancía</td><td className="text-right">{formatCents(r.subtotal, cur)}</td></tr>
              <tr><td colSpan={landed ? 4 : 3} className="text-right text-muted">IVA</td><td className="text-right">{formatCents(r.taxTotal, cur)}</td></tr>
              {extras.map((x, i) => <tr key={i}><td colSpan={landed ? 4 : 3} className="text-right text-muted">{x.concept}</td><td className="text-right">{formatCents(x.amount, cur)}</td></tr>)}
              <tr><td colSpan={landed ? 4 : 3} className="text-right font-semibold">Total</td><td className="text-right font-semibold">{formatCents(r.total, cur)}</td></tr>
            </tfoot>
          </Table>
        </Card>
        <div className="space-y-6">
          <Card title="Datos">
            <Description
              items={[
                { label: "Proveedor", value: <Link className="link" href={`/compras/proveedores/${d.supplier.id}`}>{d.supplier.name}</Link> },
                { label: "Factura", value: r.supplierInvoice },
                { label: "Fecha factura", value: r.invoiceDate },
                { label: "Recibió", value: d.receivedByName },
                { label: "Notas", value: r.notes },
              ]}
            />
          </Card>
          {d.payable && (
            <Card title="Cuenta por pagar" actions={d.payable.status === "open" && <ButtonLink variant="secondary" href={`/compras/por-pagar?pagar=${d.payable.id}`}>Registrar pago</ButtonLink>}>
              <Description
                items={[
                  { label: "Importe", value: formatCents(d.payable.amount, cur) },
                  { label: "Saldo", value: <span className="font-semibold">{formatCents(d.payable.balance, cur)}</span> },
                  { label: "Vence", value: d.payable.dueDate },
                  { label: "Estado", value: d.payable.status === "paid" ? <Badge tone="success">Pagada</Badge> : <Badge tone="warning">Abierta</Badge> },
                ]}
              />
              {payments.length > 0 && (
                <ul className="mt-4 divide-y divide-border border-t border-border text-sm">
                  {payments.map((p) => (
                    <li key={p.pp.id} className="flex justify-between py-2">
                      <span>{p.pp.paidAt} · {p.pp.method}{p.pp.reference && ` · ${p.pp.reference}`}{p.pp.kind === "credit_note" && <> <Badge tone="info">Nota de crédito</Badge></>}</span>
                      <span className="font-medium">{formatCents(p.pp.amount, cur)}</span>
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
