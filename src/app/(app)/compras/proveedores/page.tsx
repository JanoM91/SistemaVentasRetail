import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, ButtonLink, Card, EmptyState, PageHeader, Table } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { listSuppliers } from "@/server/modules/purchasing/service";
import { formatCents } from "@/lib/money";
import { ComprasTabs } from "../tabs";

export const metadata: Metadata = { title: "Proveedores" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ q?: string; inactivos?: string }> }) {
  const ctx = await requirePagePermission("purchases.view");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const q = await searchParams;
  const rows = await listSuppliers(ctx, { q: q.q, includeInactive: q.inactivos === "1" });
  const cur = ctx.company.currency;
  const canCreate = hasPermission(ctx, "purchases.create");
  return (
    <>
      <PageHeader title="Proveedores" actions={canCreate && <ButtonLink href="/compras/proveedores/nuevo">Nuevo proveedor</ButtonLink>} />
      <ComprasTabs ctx={ctx} active="/compras/proveedores" />
      <Card className="mb-4">
        <form method="get" className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <input name="q" defaultValue={q.q} placeholder="Nombre, clave o RFC" className="field" aria-label="Buscar proveedor" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="inactivos" value="1" defaultChecked={q.inactivos === "1"} className="accent-primary" /> Incluir inactivos</label>
          <button className="min-h-11 rounded-app bg-primary px-4 text-sm font-medium text-primary-fg">Buscar</button>
        </form>
      </Card>
      {rows.length === 0 ? (
        <EmptyState title="Sin proveedores" description="Da de alta a quien te surte para hacer órdenes y llevar sus saldos." action={canCreate ? <ButtonLink href="/compras/proveedores/nuevo">Nuevo proveedor</ButtonLink> : undefined} />
      ) : (
        <Table>
          <thead><tr><th>Proveedor</th><th className="hidden md:table-cell">Contacto</th><th className="hidden sm:table-cell">Crédito</th><th className="text-right">Saldo</th><th className="hidden sm:table-cell text-right">Vencido</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.s.id}>
                <td>
                  <Link className="link font-medium" href={`/compras/proveedores/${r.s.id}`}>{r.s.name}</Link> {r.s.deactivatedAt && <Badge>Inactivo</Badge>}
                  <span className="block font-mono text-xs text-muted">{r.s.code}{r.s.taxId && ` · ${r.s.taxId}`}</span>
                </td>
                <td className="hidden md:table-cell text-muted">{[r.s.contactName, r.s.phone].filter(Boolean).join(" · ") || "—"}</td>
                <td className="hidden sm:table-cell text-muted">{r.s.paymentTermsDays ? `${r.s.paymentTermsDays} días` : "Contado"}</td>
                <td className="text-right font-medium">{formatCents(r.balance, cur)}</td>
                <td className="hidden sm:table-cell text-right">{r.overdue ? <span className="text-danger">{formatCents(r.overdue, cur)}</span> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
