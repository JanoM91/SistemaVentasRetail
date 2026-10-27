import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, ButtonLink, EmptyState, PageHeader, Stat, Table } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { listPromotions } from "@/server/modules/promotions/service";
import { formatCents } from "@/lib/money";
import { PromocionesTabs } from "./tabs";
import { promoStatus, summarize } from "./data";

export const metadata: Metadata = { title: "Promociones" };

export default async function PromotionsPage() {
  const ctx = await requirePagePermission("promotions.view");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const rows = await listPromotions(ctx);
  const cur = ctx.company.currency;
  const tz = ctx.company.timezone;
  const live = rows.filter((r) => promoStatus(r.p, r.uses).label === "Vigente");
  return (
    <>
      <PageHeader
        title="Promociones"
        description="Se aplican solas en el punto de venta (también sin conexión) y el ticket explica cada ahorro."
        actions={hasPermission(ctx, "promotions.manage") && <ButtonLink href="/promociones/nueva">Nueva promoción</ButtonLink>}
      />
      <PromocionesTabs active="/promociones" />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Vigentes" value={live.length} />
        <Stat label="Usos" value={rows.reduce((a, r) => a + r.uses, 0)} />
        <Stat label="Descuento otorgado" value={formatCents(rows.reduce((a, r) => a + r.discount, 0), cur)} />
      </div>
      {!ctx.company.settings?.promotions?.allowStacking && rows.length > 1 && (
        <div className="mb-4"><Alert tone="info">Las promociones no se acumulan: cada producto recibe solo la de mayor prioridad. Puedes cambiarlo en Configuración.</Alert></div>
      )}
      {rows.length === 0 ? (
        <EmptyState title="Sin promociones" description="Crea un 2x1, un precio especial por horario, un combo o un cupón de bienvenida." action={hasPermission(ctx, "promotions.manage") ? <ButtonLink href="/promociones/nueva">Nueva promoción</ButtonLink> : undefined} />
      ) : (
        <Table>
          <thead><tr><th>Promoción</th><th className="hidden md:table-cell">Regla</th><th className="text-right">Usos</th><th className="hidden sm:table-cell text-right">Descuento</th><th>Estado</th></tr></thead>
          <tbody>
            {rows.map(({ p, uses, discount, coupons }) => {
              const st = promoStatus(p, uses);
              const s = summarize(p, cur, tz);
              return (
                <tr key={p.id}>
                  <td><Link className="link font-medium" href={`/promociones/${p.id}`}>{p.name}</Link><span className="block text-xs text-muted">{s.kindLabel}{p.priority ? ` · prioridad ${p.priority}` : ""}{coupons ? ` · ${coupons} cupón(es)` : ""}</span></td>
                  <td className="hidden md:table-cell text-sm text-muted">{s.text}</td>
                  <td className="text-right">{uses}{p.maxUses ? <span className="text-muted"> / {p.maxUses}</span> : null}</td>
                  <td className="hidden sm:table-cell text-right">{formatCents(discount, cur)}</td>
                  <td><Badge tone={st.tone}>{st.label}</Badge></td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
