import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card, EmptyState, PageHeader, Table } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { listForReview } from "@/server/modules/settings/service";
import { formatCents } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { reviewSaleAction, resolveSyncAction } from "../actions";
import { VentasTabs } from "../tabs";
import { ReviewForm } from "./review-form";

export const metadata: Metadata = { title: "Ventas por revisar" };

const FLAG_LABELS: Record<string, string> = {
  price_changed: "Precio distinto al del catálogo",
  negative_stock: "Inventario quedó negativo",
  session_closed: "Turno cerrado al sincronizar",
  variant_inactive: "Producto desactivado",
  late_sync: "Sincronización tardía",
  discount_unauthorized: "Descuento sin autorización",
  customer_missing: "Cliente inexistente",
  promotion_mismatch: "Promoción distinta a la vigente",
};

export default async function ReviewPage() {
  const ctx = await requirePagePermission("pos.cancel");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const { flagged, rejected } = await listForReview(ctx);
  const cur = ctx.company.currency;
  return (
    <>
      <PageHeader title="Ventas" description="Ventas sin conexión que entraron con observaciones y envíos rechazados. Revísalos y deja nota de lo que se hizo." />
      <VentasTabs ctx={ctx} active="/ventas/revision" />
      {flagged.length === 0 && rejected.length === 0 ? (
        <EmptyState title="Nada pendiente" description="Todas las ventas sincronizadas están en orden." />
      ) : (
        <div className="space-y-6">
          {flagged.length > 0 && (
            <Card title={`Ventas con observaciones (${flagged.length})`}>
              <Table className="border-0">
                <thead><tr><th>Venta</th><th>Observaciones</th><th className="text-right">Total</th><th /></tr></thead>
                <tbody>
                  {flagged.map(({ s, branchName, sellerName }) => (
                    <tr key={s.id}>
                      <td className="align-top"><Link className="link font-mono" href={`/ventas/${s.id}`}>{s.folio}</Link><span className="block text-xs text-muted">{formatDateTime(s.soldAt)} · {branchName} · {sellerName}</span></td>
                      <td className="align-top text-sm">
                        <ul className="space-y-1">{s.flags.map((f, i) => <li key={i}><b>{FLAG_LABELS[f.code] ?? f.code}:</b> {f.detail}</li>)}</ul>
                      </td>
                      <td className="align-top text-right">{formatCents(s.total, cur)}</td>
                      <td className="align-top text-right"><ReviewForm id={s.id} action={reviewSaleAction} /></td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
          {rejected.length > 0 && (
            <Card title={`Envíos rechazados (${rejected.length})`}>
              <p className="mb-3 text-sm text-muted">Ventas cobradas sin conexión que el servidor no pudo registrar. El ticket está en el dispositivo; regístrala de nuevo o ajusta la caja según corresponda.</p>
              <Table className="border-0">
                <thead><tr><th>Fecha</th><th>Motivo</th><th className="hidden md:table-cell">Dispositivo</th><th /></tr></thead>
                <tbody>
                  {rejected.map(({ e, userName, branchName }) => (
                    <tr key={e.id}>
                      <td className="align-top whitespace-nowrap text-muted">{formatDateTime(e.createdAt)}<span className="block text-xs">{[userName, branchName].filter(Boolean).join(" · ")}</span></td>
                      <td className="align-top text-sm">{String((e.detail as { error?: string }).error ?? "Rechazada")}</td>
                      <td className="hidden md:table-cell align-top font-mono text-xs text-muted">{e.deviceId ?? "—"}</td>
                      <td className="align-top text-right"><ReviewForm id={e.id} action={resolveSyncAction} label="Marcar resuelto" /></td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
