import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert, Badge, Card, PageHeader, Stat, Table } from "@/components/ui";
import { ConfirmAction } from "@/components/ui/form";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { NotFoundError } from "@/server/errors";
import { getPromotion } from "@/server/modules/promotions/service";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { togglePromotionAction, toggleCouponAction } from "../actions";
import { promotionFormOptions, promoStatus, summarize, toFormValues } from "../data";
import { PromotionForm } from "../promotion-form";
import { CouponForm } from "./coupon-forms";

export const metadata: Metadata = { title: "Promoción" };

export default async function PromotionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ guardada?: string }> }) {
  const ctx = await requirePagePermission("promotions.view");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const { id } = await params;
  const { guardada } = await searchParams;
  let d;
  try {
    d = await getPromotion(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const p = d.promotion;
  const cur = ctx.company.currency;
  const tz = ctx.company.timezone;
  const canManage = hasPermission(ctx, "promotions.manage");
  const st = promoStatus(p, d.uses);
  const opts = await promotionFormOptions(ctx);
  return (
    <>
      <PageHeader
        title={p.name}
        description={<>{summarize(p, cur, tz).text} · <Badge tone={st.tone}>{st.label}</Badge></>}
        actions={
          canManage &&
          (p.isActive ? (
            <ConfirmAction action={togglePromotionAction} label="Pausar" confirmTitle="¿Pausar la promoción?" confirmText="Deja de aplicarse en caja. Puedes reactivarla después." hiddenFields={{ id, active: "0" }} />
          ) : (
            <ConfirmAction action={togglePromotionAction} label="Reactivar" variant="primary" confirmTitle="¿Reactivar la promoción?" hiddenFields={{ id, active: "1" }} />
          ))
        }
      />
      {guardada && <div className="mb-4"><Alert tone="success" title="Promoción guardada">Los puntos de venta la toman al actualizar su catálogo (al abrirse, al volver la conexión o al cobrar).</Alert></div>}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Usos" value={<>{d.uses}{p.maxUses ? <span className="text-base text-muted"> / {p.maxUses}</span> : null}</>} />
        <Stat label="Descuento otorgado" value={formatCents(d.discount, cur)} />
        <Stat label="Promedio por uso" value={d.uses ? formatCents(Math.round(d.discount / d.uses), cur) : "—"} />
      </div>
      {p.requiresCoupon && (
        <Card title="Cupones" className="mb-6">
          {canManage && <div className="mb-4"><CouponForm promotionId={id} /></div>}
          {d.coupons.length === 0 ? (
            <p className="text-sm text-muted">Aún no hay códigos. Sin cupón esta promoción no se aplica.</p>
          ) : (
            <Table className="border-0">
              <thead><tr><th>Código</th><th className="text-right">Usos</th><th>Vence</th><th>Estado</th>{canManage && <th />}</tr></thead>
              <tbody>
                {d.coupons.map((c) => (
                  <tr key={c.id}>
                    <td className="font-mono">{c.code}</td>
                    <td className="text-right">{c.usedCount}{c.maxUses !== null && <span className="text-muted"> / {c.maxUses}</span>}</td>
                    <td className="text-muted">{c.expiresAt ? formatDate(c.expiresAt) : "—"}</td>
                    <td>{!c.isActive ? <Badge>Desactivado</Badge> : c.maxUses !== null && c.usedCount >= c.maxUses ? <Badge tone="warning">Usado</Badge> : <Badge tone="success">Disponible</Badge>}</td>
                    {canManage && (
                      <td className="text-right">
                        <ConfirmAction action={toggleCouponAction} label={c.isActive ? "Desactivar" : "Activar"} confirmTitle={`¿${c.isActive ? "Desactivar" : "Activar"} ${c.code}?`} hiddenFields={{ id: c.id, promotionId: id, active: c.isActive ? "0" : "1" }} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
      {canManage ? (
        <PromotionForm id={id} initial={toFormValues(p, tz, d.productNames, d.bundleNames)} {...opts} currency={cur} />
      ) : (
        <Alert tone="info">No tienes permiso para editar promociones.</Alert>
      )}
    </>
  );
}
