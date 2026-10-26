import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, ButtonLink, EmptyState, PageHeader, Table } from "@/components/ui";
import { ConfirmAction } from "@/components/ui/form";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { NotFoundError } from "@/server/errors";
import { getKardex, listAccessibleWarehouses, MANUAL_MOVEMENT_TYPES } from "@/server/modules/inventory/service";
import { formatCents, formatQty } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { reverseMovementAction } from "../../actions";

export const metadata: Metadata = { title: "Kardex" };

export default async function KardexPage({ params, searchParams }: { params: Promise<{ variantId: string }>; searchParams: Promise<{ alm?: string }> }) {
  const ctx = await requirePagePermission("inventory.view");
  const { variantId } = await params;
  const { alm } = await searchParams;
  let k;
  try {
    k = await getKardex(ctx, variantId, alm || null);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const whs = await listAccessibleWarehouses(ctx);
  const showCost = hasPermission(ctx, "inventory.view_cost");
  const canReverse = hasPermission(ctx, "inventory.authorize");
  const cur = ctx.company?.currency ?? "MXN";
  const tz = ctx.company?.timezone;
  return (
    <>
      <PageHeader
        title={`Kardex · ${k.product.name}${k.variant.variantName ? ` · ${k.variant.variantName}` : ""}`}
        description={<span className="font-mono">{k.variant.sku}</span>}
        actions={
          <>
            <ButtonLink variant="secondary" href={`/catalogo/${k.product.id}`}>Ver producto</ButtonLink>
            {hasPermission(ctx, "inventory.adjust") && <ButtonLink href={`/inventario/movimiento${alm ? `?alm=${alm}` : ""}`}>Registrar movimiento</ButtonLink>}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link className={`rounded-full border px-3 py-1 ${!alm ? "border-primary bg-primary/10 text-primary" : "border-border"}`} href={`/inventario/kardex/${variantId}`}>Todos los almacenes</Link>
        {whs.map((w) => (
          <Link key={w.id} className={`rounded-full border px-3 py-1 ${alm === w.id ? "border-primary bg-primary/10 text-primary" : "border-border"}`} href={`/inventario/kardex/${variantId}?alm=${w.id}`}>{w.branchName} · {w.code}</Link>
        ))}
      </div>
      {k.items.length === 0 ? (
        <EmptyState title="Sin movimientos" description="Este producto aún no tiene entradas ni salidas." />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Movimiento</th>
              <th className="text-right">Cantidad</th>
              <th className="text-right">Saldo</th>
              {showCost && <th className="hidden text-right md:table-cell">Costo unit.</th>}
              {showCost && <th className="hidden text-right lg:table-cell">Costo prom.</th>}
              <th className="hidden md:table-cell">Detalle</th>
              {canReverse && <th></th>}
            </tr>
          </thead>
          <tbody>
            {k.items.map((m) => (
              <tr key={m.id} className={m.reversedBy ? "opacity-60" : ""}>
                <td className="whitespace-nowrap text-muted">{formatDateTime(m.createdAt, tz)}<span className="block text-xs">{m.warehouseCode}</span></td>
                <td>
                  {m.label}
                  {m.reversedBy && <Badge tone="warning">reversado</Badge>}
                  {m.referenceType === "sale" && m.referenceId && <Link className="link block text-xs" href={`/ventas/${m.referenceId}`}>Ver venta</Link>}
                </td>
                <td className={`text-right font-medium ${m.quantity < 0 ? "text-danger" : "text-success"}`}>{m.quantity > 0 ? "+" : ""}{formatQty(m.quantity)}</td>
                <td className="text-right">{formatQty(m.balanceAfter)}</td>
                {showCost && <td className="hidden text-right md:table-cell">{formatCents(m.unitCost, cur)}</td>}
                {showCost && <td className="hidden text-right lg:table-cell">{formatCents(m.avgCostAfter, cur)}</td>}
                <td className="hidden max-w-64 text-xs text-muted md:table-cell">{m.reason ?? "—"}{m.userName && <span className="block">por {m.userName}</span>}</td>
                {canReverse && (
                  <td className="text-right">
                    {(MANUAL_MOVEMENT_TYPES as readonly string[]).includes(m.movementType) && !m.reversedBy && (
                      <ConfirmAction
                        action={reverseMovementAction}
                        label="Reversar"
                        variant="ghost"
                        confirmTitle="¿Reversar este movimiento?"
                        confirmText="Se registrará el movimiento inverso; el original se conserva en el kardex."
                        requireReason
                        hiddenFields={{ ledgerId: m.id, variantId }}
                      />
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
