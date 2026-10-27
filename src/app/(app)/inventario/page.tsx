import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, ButtonLink, Card, EmptyState, PageHeader, Stat, Table } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { listAccessibleWarehouses, listStock } from "@/server/modules/inventory/service";
import { formatCents, formatQty } from "@/lib/money";
import { InventarioTabs } from "./tabs";

export const metadata: Metadata = { title: "Inventario" };

const STATUS = {
  ok: { tone: "success", label: "OK" },
  low: { tone: "warning", label: "Bajo" },
  out: { tone: "danger", label: "Agotado" },
  negative: { tone: "danger", label: "Negativo" },
} as const;

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ alm?: string; q?: string; alertas?: string }> }) {
  const ctx = await requirePagePermission("inventory.view");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const q = await searchParams;
  const whs = await listAccessibleWarehouses(ctx);
  if (!whs.length) return <EmptyState title="No tienes almacenes disponibles" description="Pide acceso a una sucursal con almacén." />;
  const wh = whs.find((w) => w.id === q.alm) ?? whs.find((w) => w.branchId === ctx.branch?.id && w.isDefault) ?? whs[0];
  const rows = await listStock(ctx, { warehouseId: wh.id, q: q.q, onlyAlerts: q.alertas === "1" });
  const showCost = hasPermission(ctx, "inventory.view_cost");
  const cur = ctx.company.currency;
  const value = rows.reduce((a, r) => a + (r.value ?? 0), 0);
  const missingCost = rows.filter((r) => r.onHand > 0 && r.avgCost === null).length;
  const alerts = rows.filter((r) => r.status !== "ok").length;
  return (
    <>
      <PageHeader
        title="Inventario"
        description="Existencias por almacén. Cada cambio queda en el kardex y no se puede borrar."
        actions={hasPermission(ctx, "inventory.adjust") && <ButtonLink href={`/inventario/movimiento?alm=${wh.id}`}>Registrar movimiento</ButtonLink>}
      />
      <InventarioTabs active="/inventario" />
      <Card className="mb-4">
        <form method="get" className="grid gap-3 sm:grid-cols-[220px_1fr_auto_auto]">
          <select name="alm" defaultValue={wh.id} className="field" aria-label="Almacén">
            {whs.map((w) => <option key={w.id} value={w.id}>{w.branchName} · {w.name}</option>)}
          </select>
          <input name="q" defaultValue={q.q} placeholder="Buscar producto o SKU" className="field" aria-label="Buscar" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="alertas" value="1" defaultChecked={q.alertas === "1"} className="accent-primary" /> Solo alertas</label>
          <button className="min-h-11 rounded-app bg-primary px-4 text-sm font-medium text-primary-fg">Ver</button>
        </form>
      </Card>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Productos" value={rows.length} />
        <Stat label="Con alerta" value={alerts} hint="bajos, agotados o negativos" />
        {showCost && <Stat label="Valor del inventario" value={formatCents(value, cur)} hint="a costo promedio" />}
        {showCost && <Stat label="Sin costo" value={missingCost} hint={missingCost ? "el valor está incompleto" : "todos con costo"} />}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Sin productos que mostrar" description="Da de alta productos que controlen inventario en el catálogo." />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Producto</th>
              <th className="text-right">Existencia</th>
              <th className="hidden text-right sm:table-cell">Reorden</th>
              {showCost && <th className="hidden text-right md:table-cell">Costo prom.</th>}
              {showCost && <th className="hidden text-right md:table-cell">Valor</th>}
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.variantId}>
                <td>
                  <Link className="link font-medium" href={`/inventario/kardex/${r.variantId}?alm=${wh.id}`}>{r.name}{r.variantName && ` · ${r.variantName}`}</Link>
                  <span className="block font-mono text-xs text-muted">{r.sku}</span>
                </td>
                <td className="text-right font-medium">{formatQty(r.onHand)}</td>
                <td className="hidden text-right text-muted sm:table-cell">{r.reorderPoint ?? r.minStock ?? "—"}</td>
                {showCost && <td className="hidden text-right md:table-cell">{r.avgCost === null ? <Badge tone="warning">sin costo</Badge> : formatCents(r.avgCost, cur)}</td>}
                {showCost && <td className="hidden text-right md:table-cell">{r.value === null ? "—" : formatCents(r.value, cur)}</td>}
                <td><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
