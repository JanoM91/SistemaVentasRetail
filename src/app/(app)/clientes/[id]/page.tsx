import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Description, PageHeader, Stat, Table } from "@/components/ui";
import { ConfirmAction } from "@/components/ui/form";
import { PrintButton } from "@/components/print-button";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { NotFoundError } from "@/server/errors";
import { getCustomerProfile, listBackofficePaymentMethods, listGroups } from "@/server/modules/customers/service";
import { formatCents, formatQty } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { toggleCustomerAction } from "../actions";
import { CustomerForm } from "../customer-form";
import { AdjustmentForm, BackofficePaymentForm, CreditTermsForm } from "./credit-forms";

export const metadata: Metadata = { title: "Cliente" };

const KIND = { charge: "Compra a crédito", payment: "Abono", reversal: "Cancelación", adjustment: "Ajuste", return: "Devolución" } as const;

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("customers.view");
  const { id } = await params;
  let d;
  try {
    d = await getCustomerProfile(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const c = d.customer;
  const cur = ctx.company?.currency ?? "MXN";
  const [groups, methods] = await Promise.all([listGroups(ctx), hasPermission(ctx, "credit.manage") ? listBackofficePaymentMethods(ctx) : Promise.resolve([])]);
  const canManage = hasPermission(ctx, "customers.manage");
  const canTerms = hasPermission(ctx, "customers.credit_manage") && ctx.enabledModules.has("credit");
  const canCollect = hasPermission(ctx, "credit.manage");
  const a = d.aging;
  return (
    <>
      <PageHeader
        title={c.name}
        description={
          <>
            <span className="font-mono">{c.code}</span>
            {d.group && <> · {d.group.name}</>}
            {c.marketingConsent && <> · <Badge tone="info">Acepta promociones</Badge></>}
            {c.deactivatedAt && <> · <Badge>Inactivo</Badge></>}
            {c.creditBlocked && <> · <Badge tone="danger">Crédito bloqueado</Badge></>}
          </>
        }
        actions={
          <>
            <PrintButton label="Imprimir estado de cuenta" />
            {canManage &&
              (c.deactivatedAt ? (
                <ConfirmAction action={toggleCustomerAction} label="Reactivar" confirmTitle="¿Reactivar cliente?" hiddenFields={{ id, active: "1" }} />
              ) : (
                <ConfirmAction action={toggleCustomerAction} label="Desactivar" variant="danger" confirmTitle="¿Desactivar cliente?" confirmText="No aparecerá en búsquedas del punto de venta. Su historial se conserva." requireReason hiddenFields={{ id, active: "0" }} />
              ))}
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Compras" value={c.purchasesCount} hint={c.firstPurchaseAt ? `cliente desde ${formatDate(c.firstPurchaseAt)}` : "aún sin compras"} />
        <Stat label="Total comprado" value={formatCents(c.purchasesTotal, cur)} />
        <Stat label="Ticket promedio" value={formatCents(d.avgTicket, cur)} />
        <Stat label="Última compra" value={c.lastPurchaseAt ? formatDate(c.lastPurchaseAt) : "—"} />
      </div>

      {d.showCredit && a && (c.creditLimit !== null || c.creditBalance !== 0 || d.movements.length > 0) && (
        <Card title="Crédito y estado de cuenta" className="mb-6">
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Saldo" value={<span data-testid="customer-balance">{formatCents(c.creditBalance, cur)}</span>} />
            <Stat label="Vencido" value={<span className={a.overdue ? "text-danger" : ""}>{formatCents(a.overdue, cur)}</span>} hint={a.oldestDueDate ? `desde ${a.oldestDueDate}` : "al corriente"} />
            <Stat label="Límite" value={c.creditLimit === null ? "Sin crédito" : formatCents(c.creditLimit, cur)} hint={c.creditLimit !== null ? `${c.creditDays} días para pagar` : undefined} />
            <Stat label="Disponible" value={c.creditLimit === null ? "—" : formatCents(Math.max(0, c.creditLimit - c.creditBalance), cur)} />
          </div>
          {a.overdue > 0 && (
            <p className="mb-4 text-sm">
              Antigüedad de lo vencido: 1–30 días {formatCents(a.d1_30, cur)} · 31–60 {formatCents(a.d31_60, cur)} · 61–90 {formatCents(a.d61_90, cur)} · más de 90 {formatCents(a.d90, cur)}
            </p>
          )}
          {d.movements.length === 0 ? (
            <p className="text-sm text-muted">Sin movimientos de crédito.</p>
          ) : (
            <Table className="border-0">
              <thead><tr><th>Fecha</th><th>Movimiento</th><th className="hidden md:table-cell">Detalle</th><th className="hidden sm:table-cell">Vence</th><th className="text-right">Cargo</th><th className="text-right">Abono</th><th className="text-right">Saldo</th></tr></thead>
              <tbody>
                {d.movements.map(({ m, saleFolio, methodName, userName }) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap text-muted">{formatDateTime(m.createdAt)}</td>
                    <td>
                      {KIND[m.kind]}{" "}
                      {m.saleId && saleFolio ? <Link className="link font-mono" href={`/ventas/${m.saleId}`}>{saleFolio}</Link> : m.folio && <span className="font-mono">{m.folio}</span>}
                    </td>
                    <td className="hidden md:table-cell text-muted">{[methodName, m.reference, m.notes, userName].filter(Boolean).join(" · ")}</td>
                    <td className="hidden sm:table-cell text-muted">{m.dueDate ?? ""}</td>
                    <td className="text-right">{m.amount > 0 ? formatCents(m.amount, cur) : ""}</td>
                    <td className="text-right text-success">{m.amount < 0 ? formatCents(-m.amount, cur) : ""}</td>
                    <td className="text-right font-medium">{formatCents(m.balanceAfter, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Card title="Historial de compras">
            {d.recentSales.length === 0 ? (
              <p className="text-sm text-muted">Sin compras registradas con este cliente.</p>
            ) : (
              <Table className="border-0">
                <thead><tr><th>Folio</th><th>Fecha</th><th className="hidden sm:table-cell">Sucursal</th><th className="text-right">Total</th></tr></thead>
                <tbody>
                  {d.recentSales.map(({ s, branchName }) => (
                    <tr key={s.id}>
                      <td><Link className="link font-mono" href={`/ventas/${s.id}`}>{s.folio}</Link> {s.status === "cancelled" && <Badge tone="danger">Cancelada</Badge>}</td>
                      <td className="text-muted">{formatDateTime(s.soldAt)}</td>
                      <td className="hidden sm:table-cell text-muted">{branchName}</td>
                      <td className="text-right font-medium">{formatCents(s.total, cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          {d.topProducts.length > 0 && (
            <Card title="Lo que más compra">
              <Table className="border-0">
                <thead><tr><th>Producto</th><th className="text-right">Veces</th><th className="text-right">Cantidad</th><th className="text-right">Importe</th></tr></thead>
                <tbody>
                  {d.topProducts.map((p) => (
                    <tr key={p.sku}><td>{p.description}<span className="block font-mono text-xs text-muted">{p.sku}</span></td><td className="text-right">{p.times}</td><td className="text-right">{formatQty(p.qty)}</td><td className="text-right">{formatCents(p.total, cur)}</td></tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </div>
        <div className="space-y-6 print:hidden">
          <Card title="Datos del cliente">
            <CustomerForm customer={c} groups={groups.map((g) => ({ id: g.g.id, name: g.g.name }))} readOnly={!canManage} />
          </Card>
          {canTerms && (
            <Card title="Condiciones de crédito">
              <CreditTermsForm customerId={id} limit={c.creditLimit} days={c.creditDays} blocked={c.creditBlocked} />
            </Card>
          )}
          {canCollect && c.creditBalance > 0 && methods.length > 0 && (
            <Card title="Registrar abono (transferencia o tarjeta)">
              <BackofficePaymentForm customerId={id} balance={c.creditBalance} methods={methods} />
            </Card>
          )}
          {canCollect && canTerms && (
            <Card title="Ajuste de saldo">
              <AdjustmentForm customerId={id} />
            </Card>
          )}
          {!d.showCredit && <Description items={[{ label: "Crédito", value: "No tienes permiso para ver saldos." }]} />}
        </div>
      </div>
    </>
  );
}
