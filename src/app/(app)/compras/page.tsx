import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, ButtonLink, Card, EmptyState, PageHeader, Stat, Table } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { listPayables, listPurchaseOrders } from "@/server/modules/purchasing/service";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { ComprasTabs } from "./tabs";
import { PO_STATUS } from "./data";

export const metadata: Metadata = { title: "Compras" };

const FILTERS = [
  { value: "open", label: "Abiertas" },
  { value: "draft", label: "Borradores" },
  { value: "sent", label: "Enviadas" },
  { value: "partial", label: "Parciales" },
  { value: "received", label: "Cerradas" },
  { value: "cancelled", label: "Canceladas" },
  { value: "", label: "Todas" },
];

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  const ctx = await requirePagePermission("purchases.view");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const q = await searchParams;
  const status = q.estado ?? "open";
  const [rows, payables] = await Promise.all([listPurchaseOrders(ctx, { status: status || null }), listPayables(ctx, { status: "open" })]);
  const cur = ctx.company.currency;
  const canCreate = hasPermission(ctx, "purchases.create");
  const canReceive = hasPermission(ctx, "purchases.receive");
  const owed = payables.reduce((a, p) => a + p.p.balance, 0);
  const overdue = payables.filter((p) => p.overdue).reduce((a, p) => a + p.p.balance, 0);
  return (
    <>
      <PageHeader
        title="Compras"
        description="Órdenes a proveedores, recepción de mercancía y cuentas por pagar."
        actions={
          <>
            {canReceive && <ButtonLink variant="secondary" href="/compras/directa">Compra directa</ButtonLink>}
            {canCreate && <ButtonLink href="/compras/nueva">Nueva orden</ButtonLink>}
          </>
        }
      />
      <ComprasTabs ctx={ctx} active="/compras" />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Órdenes mostradas" value={rows.length} />
        <Stat label="Por recibir" value={rows.filter((r) => r.po.status === "sent" || r.po.status === "partial").length} hint="enviadas o parciales" />
        <Stat label="Saldo por pagar" value={formatCents(owed, cur)} />
        <Stat label="Vencido" value={formatCents(overdue, cur)} hint={overdue ? "revisa Por pagar" : "al corriente"} />
      </div>
      <Card className="mb-4">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link key={f.value} href={f.value === "open" ? "/compras" : `/compras?estado=${f.value}`} className={`rounded-full border px-3 py-1 text-sm ${status === f.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted hover:text-text"}`}>
              {f.label}
            </Link>
          ))}
        </div>
      </Card>
      {rows.length === 0 ? (
        <EmptyState
          title="No hay órdenes con ese filtro"
          description="Crea una orden para pedir mercancía a un proveedor, o registra una compra directa si ya la recibiste."
          action={canCreate ? <ButtonLink href="/compras/nueva">Nueva orden</ButtonLink> : undefined}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Folio</th>
              <th>Proveedor</th>
              <th className="hidden md:table-cell">Almacén</th>
              <th className="hidden sm:table-cell">Creada</th>
              <th className="hidden lg:table-cell">Entrega</th>
              <th className="text-right">Total</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.po.id}>
                <td><Link className="link font-mono font-medium" href={`/compras/${r.po.id}`}>{r.po.folio}</Link></td>
                <td>{r.supplierName}</td>
                <td className="hidden md:table-cell text-muted">{r.warehouseName}</td>
                <td className="hidden sm:table-cell text-muted">{formatDate(r.po.createdAt)}</td>
                <td className="hidden lg:table-cell text-muted">{r.po.expectedAt ?? "—"}</td>
                <td className="text-right font-medium">{formatCents(r.po.total, cur)}</td>
                <td><Badge tone={PO_STATUS[r.po.status].tone}>{PO_STATUS[r.po.status].label}</Badge></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
