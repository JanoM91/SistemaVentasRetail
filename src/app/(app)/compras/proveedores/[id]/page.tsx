import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader, Stat, Table } from "@/components/ui";
import { ConfirmAction } from "@/components/ui/form";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { NotFoundError } from "@/server/errors";
import { canSeeCosts, getSupplier, listPayables, listPurchaseOrders, supplierPriceHistory } from "@/server/modules/purchasing/service";
import { formatCents, formatQty } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { toggleSupplierAction } from "../../actions";
import { PO_STATUS } from "../../data";
import { SupplierForm } from "../supplier-form";

export const metadata: Metadata = { title: "Proveedor" };

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("purchases.view");
  const { id } = await params;
  let s;
  try {
    s = await getSupplier(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const cur = ctx.company?.currency ?? "MXN";
  const [payables, orders, prices] = await Promise.all([listPayables(ctx, { supplierId: id, status: "open" }), listPurchaseOrders(ctx, { supplierId: id, limit: 10 }), canSeeCosts(ctx) ? supplierPriceHistory(ctx, id, 30) : Promise.resolve([])]);
  const balance = payables.reduce((a, p) => a + p.p.balance, 0);
  const overdue = payables.filter((p) => p.overdue).reduce((a, p) => a + p.p.balance, 0);
  const canEdit = hasPermission(ctx, "purchases.create");
  return (
    <>
      <PageHeader
        title={s.name}
        description={<><span className="font-mono">{s.code}</span>{s.taxId && ` · ${s.taxId}`} {s.deactivatedAt && <Badge>Inactivo</Badge>}</>}
        actions={
          hasPermission(ctx, "purchases.authorize") &&
          (s.deactivatedAt ? (
            <ConfirmAction action={toggleSupplierAction} label="Reactivar" confirmTitle="¿Reactivar proveedor?" hiddenFields={{ id, active: "1" }} />
          ) : (
            <ConfirmAction action={toggleSupplierAction} label="Desactivar" variant="danger" confirmTitle="¿Desactivar proveedor?" confirmText="Ya no aparecerá para nuevas compras. Su historial se conserva." requireReason hiddenFields={{ id, active: "0" }} />
          ))
        }
      />
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Saldo por pagar" value={formatCents(balance, cur)} />
        <Stat label="Vencido" value={formatCents(overdue, cur)} />
        <Stat label="Condiciones" value={s.paymentTermsDays ? `${s.paymentTermsDays} días` : "Contado"} hint={`Entrega en ~${s.leadTimeDays} días`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Datos del proveedor">{canEdit ? <SupplierForm supplier={s} /> : <p className="text-sm text-muted">{s.contactName} {s.phone} {s.email}</p>}</Card>
        <div className="space-y-6">
          <Card title="Órdenes recientes">
            {orders.length === 0 ? <p className="text-sm text-muted">Sin órdenes.</p> : (
              <ul className="divide-y divide-border text-sm">
                {orders.map((o) => (
                  <li key={o.po.id} className="flex items-center justify-between py-2">
                    <span><Link className="link font-mono" href={`/compras/${o.po.id}`}>{o.po.folio}</Link> <span className="text-muted">· {formatDate(o.po.createdAt)}</span></span>
                    <span className="flex items-center gap-2"><Badge tone={PO_STATUS[o.po.status].tone}>{PO_STATUS[o.po.status].label}</Badge>{formatCents(o.po.total, cur)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {prices.length > 0 && (
            <Card title="Historial de costos">
              <Table className="border-0">
                <thead><tr><th>Fecha</th><th>Producto</th><th className="text-right">Cant.</th><th className="text-right">Costo</th></tr></thead>
                <tbody>
                  {prices.map((p, i) => (
                    <tr key={i}>
                      <td className="text-muted">{formatDate(p.receivedAt)}</td>
                      <td>{p.name}{p.variantName && ` · ${p.variantName}`}</td>
                      <td className="text-right">{formatQty(p.quantity)}</td>
                      <td className="text-right">{formatCents(p.unitCost, cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
