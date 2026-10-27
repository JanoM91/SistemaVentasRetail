import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, EmptyState, PageHeader, Stat, Table } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { requirePagePermission } from "@/server/context";
import { listReceivables } from "@/server/modules/customers/service";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { ClientesTabs } from "../tabs";

export const metadata: Metadata = { title: "Cuentas por cobrar" };

export default async function ReceivablesPage() {
  const ctx = await requirePagePermission("credit.view");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const r = await listReceivables(ctx);
  const cur = ctx.company.currency;
  const m = (v: number) => (v ? formatCents(v, cur) : <span className="text-muted">—</span>);
  return (
    <>
      <PageHeader title="Cuentas por cobrar" description="Saldos de clientes a crédito con antigüedad por días vencidos. Los abonos se aplican a lo más antiguo." actions={<PrintButton />} />
      <ClientesTabs ctx={ctx} active="/clientes/por-cobrar" />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Por cobrar" value={formatCents(r.totals.balance, cur)} />
        <Stat label="Vencido" value={<span className={r.totals.overdue ? "text-danger" : ""}>{formatCents(r.totals.overdue, cur)}</span>} hint={r.totals.balance ? `${Math.round((r.totals.overdue / r.totals.balance) * 100)} % del saldo` : undefined} />
        <Stat label="Clientes con crédito" value={r.withCredit} />
        <Stat label="Crédito otorgado" value={formatCents(r.totalLimit, cur)} hint={r.totalLimit ? `${Math.round((r.totals.balance / r.totalLimit) * 100)} % utilizado` : undefined} />
      </div>
      {r.list.length === 0 ? (
        <EmptyState title="Nadie te debe" description="Aquí aparecen los clientes con saldo de ventas a crédito." />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Cliente</th>
              <th className="text-right">Saldo</th>
              <th className="hidden md:table-cell text-right">Por vencer</th>
              <th className="text-right">1–30</th>
              <th className="hidden sm:table-cell text-right">31–60</th>
              <th className="hidden sm:table-cell text-right">61–90</th>
              <th className="hidden sm:table-cell text-right">+90</th>
              <th className="hidden lg:table-cell">Último abono</th>
            </tr>
          </thead>
          <tbody>
            {r.list.map(({ customer: c, aging: a, lastPaymentAt }) => (
              <tr key={c.id}>
                <td>
                  <Link className="link font-medium" href={`/clientes/${c.id}`}>{c.name}</Link> {c.creditBlocked && <Badge tone="danger">Bloqueado</Badge>}
                  <span className="block text-xs text-muted">{[c.phone, c.creditLimit !== null ? `límite ${formatCents(c.creditLimit, cur)}` : null].filter(Boolean).join(" · ")}</span>
                </td>
                <td className="text-right font-semibold">{formatCents(a.balance, cur)}</td>
                <td className="hidden md:table-cell text-right">{m(a.current)}</td>
                <td className="text-right">{m(a.d1_30)}</td>
                <td className="hidden sm:table-cell text-right">{m(a.d31_60)}</td>
                <td className="hidden sm:table-cell text-right">{m(a.d61_90)}</td>
                <td className="hidden sm:table-cell text-right text-danger">{m(a.d90)}</td>
                <td className="hidden lg:table-cell text-muted">{lastPaymentAt ? formatDate(lastPaymentAt) : "Nunca"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td>Total</td>
              <td className="text-right">{formatCents(r.totals.balance, cur)}</td>
              <td className="hidden md:table-cell text-right">{formatCents(r.totals.current, cur)}</td>
              <td className="text-right">{formatCents(r.totals.d1_30, cur)}</td>
              <td className="hidden sm:table-cell text-right">{formatCents(r.totals.d31_60, cur)}</td>
              <td className="hidden sm:table-cell text-right">{formatCents(r.totals.d61_90, cur)}</td>
              <td className="hidden sm:table-cell text-right">{formatCents(r.totals.d90, cur)}</td>
              <td className="hidden lg:table-cell" />
            </tr>
          </tfoot>
        </Table>
      )}
    </>
  );
}
