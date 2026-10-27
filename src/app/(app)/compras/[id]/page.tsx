import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, ButtonLink, Card, Description, PageHeader, Table } from "@/components/ui";
import { ConfirmAction } from "@/components/ui/form";
import { PrintButton } from "@/components/print-button";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { NotFoundError } from "@/server/errors";
import { getPurchaseOrder } from "@/server/modules/purchasing/service";
import { formatCents, formatQty } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { cancelPurchaseOrderAction, sendPurchaseOrderAction } from "../actions";
import { PO_STATUS } from "../data";

export const metadata: Metadata = { title: "Orden de compra" };

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("purchases.view");
  const { id } = await params;
  let d;
  try {
    d = await getPurchaseOrder(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { po } = d;
  const cur = ctx.company?.currency ?? "MXN";
  const st = PO_STATUS[po.status];
  const open = po.status === "sent" || po.status === "partial";
  const canAuthorize = hasPermission(ctx, "purchases.authorize");
  const pendingLines = d.lines.filter((l) => l.quantityReceived < l.quantityOrdered);
  return (
    <>
      <PageHeader
        title={`Orden ${po.folio}`}
        description={<>{d.supplier.name} · {d.warehouse?.name} · <Badge tone={st.tone}>{st.label}</Badge></>}
        actions={
          <>
            <PrintButton label="Imprimir" />
            {po.status === "draft" && hasPermission(ctx, "purchases.create") && <ButtonLink variant="secondary" href={`/compras/${id}/editar`}>Editar</ButtonLink>}
            {po.status === "draft" && canAuthorize && (
              <ConfirmAction action={sendPurchaseOrderAction} label="Enviar al proveedor" variant="primary" confirmTitle={`¿Enviar ${po.folio}?`} confirmText={`Total ${formatCents(po.total, cur)}. Ya no podrá editarse y quedará lista para recibir.`} hiddenFields={{ id }} />
            )}
            {open && hasPermission(ctx, "purchases.receive") && <ButtonLink href={`/compras/${id}/recibir`}>Recibir mercancía</ButtonLink>}
            {(po.status === "draft" || open) && canAuthorize && (
              <ConfirmAction
                action={cancelPurchaseOrderAction}
                label={po.status === "partial" ? "Cerrar con faltantes" : "Cancelar orden"}
                variant="danger"
                confirmTitle={po.status === "partial" ? "¿Cerrar la orden con lo recibido?" : "¿Cancelar la orden?"}
                confirmText={po.status === "partial" ? "Lo pendiente ya no se esperará. Lo recibido se conserva." : "No se ha recibido nada; la orden queda cancelada."}
                requireReason
                hiddenFields={{ id }}
              />
            )}
          </>
        }
      />
      {po.status === "draft" && !canAuthorize && <div className="mb-4"><Alert tone="info">Este borrador necesita que alguien con permiso de autorizar compras lo envíe.</Alert></div>}
      {po.cancelReason && <div className="mb-4"><Alert tone={po.status === "cancelled" ? "danger" : "warning"} title={po.status === "cancelled" ? "Orden cancelada" : "Orden cerrada con faltantes"}>{po.cancelReason}</Alert></div>}
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card title="Productos">
          <Table className="border-0">
            <thead>
              <tr><th>Producto</th><th className="text-right">Pedido</th><th className="text-right">Recibido</th><th className="text-right">Costo</th><th className="text-right">Importe</th></tr>
            </thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.id}>
                  <td><span className="block font-medium">{l.name}{l.variantName && ` · ${l.variantName}`}</span><span className="font-mono text-xs text-muted">{l.sku}</span></td>
                  <td className="text-right">{formatQty(l.quantityOrdered)}</td>
                  <td className="text-right">{l.quantityReceived > 0 ? <span className={l.quantityReceived < l.quantityOrdered ? "text-warning" : "text-success"}>{formatQty(l.quantityReceived)}</span> : <span className="text-muted">0</span>}</td>
                  <td className="text-right">{formatCents(l.unitCost, cur)}</td>
                  <td className="text-right">{formatCents(Math.round(l.quantityOrdered * l.unitCost), cur)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={4} className="text-right text-muted">Subtotal</td><td className="text-right">{formatCents(po.subtotal, cur)}</td></tr>
              <tr><td colSpan={4} className="text-right text-muted">IVA</td><td className="text-right">{formatCents(po.taxTotal, cur)}</td></tr>
              <tr><td colSpan={4} className="text-right font-semibold">Total</td><td className="text-right font-semibold">{formatCents(po.total, cur)}</td></tr>
            </tfoot>
          </Table>
        </Card>
        <div className="space-y-6">
          <Card title="Datos">
            <Description
              items={[
                { label: "Proveedor", value: <Link className="link" href={`/compras/proveedores/${d.supplier.id}`}>{d.supplier.name}</Link> },
                { label: "Contacto", value: [d.supplier.contactName, d.supplier.phone].filter(Boolean).join(" · ") || null },
                { label: "Creada", value: formatDateTime(po.createdAt) },
                { label: "Enviada", value: po.sentAt ? formatDateTime(po.sentAt) : null },
                { label: "Entrega esperada", value: po.expectedAt },
                { label: "Pendiente", value: open ? `${pendingLines.length} producto(s)` : null },
                { label: "Notas", value: po.notes },
              ]}
            />
          </Card>
          <Card title="Recepciones">
            {d.receipts.length === 0 ? (
              <p className="text-sm text-muted">Aún no se recibe mercancía de esta orden.</p>
            ) : (
              <ul className="divide-y divide-border">
                {d.receipts.map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                    <span><Link className="link font-mono" href={`/compras/recepciones/${r.id}`}>{r.folio}</Link> <span className="text-muted">· {formatDate(r.receivedAt)}{r.supplierInvoice && ` · factura ${r.supplierInvoice}`}</span></span>
                    <span className="font-medium">{formatCents(r.total, cur)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
