import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert, Badge, ButtonLink, Card, Description, PageHeader, Table } from "@/components/ui";
import { AppForm, FormField, Input, SubmitButton } from "@/components/ui/form";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { NotFoundError } from "@/server/errors";
import { getSale } from "@/server/modules/sales/service";
import { formatCents, formatQty } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { cancelSaleAction } from "../actions";

export const metadata: Metadata = { title: "Venta" };

const FLAG_LABELS: Record<string, string> = {
  price_changed: "Precio distinto al del catálogo",
  negative_stock: "Inventario quedó negativo",
  session_closed: "El turno ya estaba cerrado al sincronizar",
  variant_inactive: "Producto desactivado al sincronizar",
  late_sync: "Sincronización tardía",
  discount_unauthorized: "Descuento sin autorización",
};

export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("pos.sell");
  const { id } = await params;
  let d;
  try {
    d = await getSale(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { sale: s } = d;
  const cur = s.currency;
  const tz = d.branch.timezone ?? d.company.timezone;
  const profit = d.showCost && s.costTotal !== null ? s.subtotal - s.costTotal : null;
  return (
    <>
      <PageHeader
        title={`Venta ${s.folio}`}
        description={<>{formatDateTime(s.soldAt, tz)} · {d.registerName} · {d.sellerName} · {s.status === "cancelled" ? <Badge tone="danger">Cancelada</Badge> : <Badge tone="success">Completada</Badge>} {s.origin === "offline" && <Badge tone="info">Sin conexión</Badge>}</>}
        actions={<ButtonLink variant="secondary" href={`/ticket/${s.id}?imprimir=1`}>Reimprimir ticket</ButtonLink>}
      />
      {s.flags.length > 0 && (
        <div className="mb-4">
          <Alert tone="warning" title="Observaciones de sincronización">
            <ul className="list-disc pl-5">{s.flags.map((f, i) => <li key={i}><b>{FLAG_LABELS[f.code] ?? f.code}:</b> {f.detail}</li>)}</ul>
          </Alert>
        </div>
      )}
      {s.status === "cancelled" && (
        <div className="mb-4"><Alert tone="danger" title="Venta cancelada">{s.cancelReason} · {formatDateTime(s.cancelledAt, tz)}</Alert></div>
      )}
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card title="Productos">
          <Table className="border-0">
            <thead><tr><th>Producto</th><th className="text-right">Cant.</th><th className="text-right">Precio</th><th className="text-right">Importe</th></tr></thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.description}<span className="block font-mono text-xs text-muted">{l.sku}{l.unitPrice !== l.listPrice && ` · lista ${formatCents(l.listPrice, cur)}`}</span>{l.discountAmount > 0 && <span className="block text-xs text-success">Descuento −{formatCents(l.discountAmount, cur)}</span>}</td>
                  <td className="text-right">{formatQty(l.quantity)}</td>
                  <td className="text-right">{formatCents(l.unitPrice, cur)}</td>
                  <td className="text-right font-medium">{formatCents(l.lineTotal, cur)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <div className="space-y-6">
          <Card title="Totales">
            <Description
              items={[
                { label: "Subtotal", value: formatCents(s.subtotal, cur) },
                { label: "Impuestos", value: formatCents(s.taxTotal, cur) },
                { label: "Descuentos", value: formatCents(s.discountTotal, cur) },
                { label: "Total", value: <b>{formatCents(s.total, cur)}</b> },
                ...(d.showCost ? [{ label: "Costo", value: s.costTotal === null ? <Badge tone="warning">incompleto</Badge> : formatCents(s.costTotal, cur) }, { label: "Utilidad bruta", value: profit === null ? <Badge tone="warning">no confiable: faltan costos</Badge> : formatCents(profit, cur) }] : []),
              ]}
            />
          </Card>
          <Card title="Pagos">
            {d.payments.map(({ p, methodName }) => (
              <div key={p.id} className="flex justify-between border-b border-border py-2 text-sm last:border-0">
                <span>{methodName}{p.reference && <span className="text-muted"> · {p.reference}</span>}{p.status === "refunded" && <Badge tone="danger">reembolsado</Badge>}</span>
                <span className="text-right">{formatCents(p.amount, cur)}{p.change > 0 && <span className="block text-xs text-muted">recibido {formatCents(p.received, cur)} · cambio {formatCents(p.change, cur)}</span>}</span>
              </div>
            ))}
          </Card>
          {s.status === "completed" && (
            <Card title="Cancelar venta">
              <p className="mb-3 text-sm text-muted">Solo ventas del turno abierto. El inventario regresa automáticamente y el efectivo se descuenta del esperado.</p>
              <AppForm action={cancelSaleAction} successMessage="Venta cancelada.">
                <input type="hidden" name="saleId" value={s.id} />
                <FormField name="reason" label="Motivo" required><Input name="reason" /></FormField>
                {!hasPermission(ctx, "pos.cancel") && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField name="authorizerUsername" label="Usuario del gerente" required><Input name="authorizerUsername" autoComplete="off" /></FormField>
                    <FormField name="authorizerPassword" label="Contraseña" required><Input name="authorizerPassword" type="password" autoComplete="off" /></FormField>
                  </div>
                )}
                <SubmitButton variant="danger" pendingText="Cancelando…">Cancelar venta</SubmitButton>
              </AppForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
