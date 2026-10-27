import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, EmptyState, PageHeader, Stat, Table } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { listPayables } from "@/server/modules/purchasing/service";
import { formatCents } from "@/lib/money";
import { ComprasTabs } from "../tabs";
import { PayDialog } from "./pay-dialog";

export const metadata: Metadata = { title: "Cuentas por pagar" };

export default async function PayablesPage({ searchParams }: { searchParams: Promise<{ estado?: string; pagar?: string }> }) {
  const ctx = await requirePagePermission("purchases.view");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const q = await searchParams;
  const status = q.estado === "paid" ? "paid" : "open";
  const rows = await listPayables(ctx, { status });
  const cur = ctx.company.currency;
  const canPay = hasPermission(ctx, "purchases.authorize");
  const total = rows.reduce((a, r) => a + r.p.balance, 0);
  const overdue = rows.filter((r) => r.overdue).reduce((a, r) => a + r.p.balance, 0);
  const soon = rows.filter((r) => r.dueSoon).reduce((a, r) => a + r.p.balance, 0);
  return (
    <>
      <PageHeader title="Cuentas por pagar" description="Saldos con proveedores por cada recepción. Las devoluciones se aplican como nota de crédito." />
      <ComprasTabs ctx={ctx} active="/compras/por-pagar" />
      {status === "open" && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="Saldo total" value={formatCents(total, cur)} />
          <Stat label="Vencido" value={formatCents(overdue, cur)} />
          <Stat label="Vence en 7 días" value={formatCents(soon, cur)} />
        </div>
      )}
      <div className="mb-4 flex gap-2">
        <Link href="/compras/por-pagar" className={`rounded-full border px-3 py-1 text-sm ${status === "open" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted"}`}>Abiertas</Link>
        <Link href="/compras/por-pagar?estado=paid" className={`rounded-full border px-3 py-1 text-sm ${status === "paid" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted"}`}>Pagadas</Link>
      </div>
      {rows.length === 0 ? (
        <EmptyState title={status === "open" ? "Sin saldos pendientes" : "Sin cuentas pagadas"} />
      ) : (
        <Table>
          <thead>
            <tr><th>Proveedor</th><th>Recepción</th><th className="hidden md:table-cell">Factura</th><th>Vence</th><th className="hidden sm:table-cell text-right">Importe</th><th className="text-right">Saldo</th>{canPay && status === "open" && <th />}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.p.id}>
                <td><Link className="link" href={`/compras/proveedores/${r.p.supplierId}`}>{r.supplierName}</Link></td>
                <td><Link className="link font-mono" href={`/compras/recepciones/${r.p.receiptId}`}>{r.receiptFolio}</Link></td>
                <td className="hidden md:table-cell text-muted">{r.supplierInvoice ?? "—"}</td>
                <td>{r.p.dueDate} {r.overdue && <Badge tone="danger">Vencida</Badge>}{r.dueSoon && <Badge tone="warning">Próxima</Badge>}</td>
                <td className="hidden sm:table-cell text-right text-muted">{formatCents(r.p.amount, cur)}</td>
                <td className="text-right font-medium">{formatCents(r.p.balance, cur)}</td>
                {canPay && status === "open" && <td className="text-right"><PayDialog payableId={r.p.id} balance={r.p.balance} label={`${r.supplierName} · ${r.receiptFolio}`} autoOpen={q.pagar === r.p.id} /></td>}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
