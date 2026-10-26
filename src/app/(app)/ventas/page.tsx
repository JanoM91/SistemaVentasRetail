import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, ButtonLink, Card, EmptyState, PageHeader, Stat, Table } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { listSales } from "@/server/modules/sales/service";
import { formatCents } from "@/lib/money";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Ventas" };
const PAGE = 50;

/** Inicio del día local (zona de la empresa) en UTC. */
function dayBounds(date: string, tz: string) {
  const [y, m, d] = date.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 12));
  const offsetMin = (new Date(guess.toLocaleString("en-US", { timeZone: tz })).getTime() - new Date(guess.toLocaleString("en-US", { timeZone: "UTC" })).getTime()) / 60000;
  const start = new Date(Date.UTC(y, m - 1, d) - offsetMin * 60000);
  return { start, end: new Date(start.getTime() + 86400000 - 1) };
}

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ fecha?: string; turno?: string; estado?: string; q?: string; marcadas?: string; p?: string }> }) {
  const ctx = await requirePagePermission("pos.sell");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const q = await searchParams;
  const tz = ctx.company.timezone;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  const fecha = q.turno ? undefined : (q.fecha ?? today);
  const bounds = fecha ? dayBounds(fecha, tz) : null;
  const page = Math.max(1, Number(q.p ?? 1));
  const { items, hasMore } = await listSales(ctx, {
    from: bounds?.start,
    to: bounds?.end,
    sessionId: q.turno || null,
    status: q.estado === "canceladas" ? "cancelled" : q.estado === "completadas" ? "completed" : null,
    flagged: q.marcadas === "1",
    q: q.q,
    limit: PAGE,
    offset: (page - 1) * PAGE,
  });
  const cur = ctx.company.currency;
  const completed = items.filter((i) => i.sale.status === "completed");
  const total = completed.reduce((a, i) => a + i.sale.total, 0);
  const qs = (o: Record<string, string>) => `/ventas?${new URLSearchParams({ ...(Object.fromEntries(Object.entries(q).filter(([, v]) => v)) as Record<string, string>), ...o })}`;
  return (
    <>
      <PageHeader title="Ventas" description={q.turno ? "Ventas del turno seleccionado." : `Ventas de ${ctx.branch?.name ?? "la sucursal"}.`} actions={<ButtonLink href="/pos">Nueva venta</ButtonLink>} />
      <Card className="mb-4">
        <form method="get" className="grid gap-3 sm:grid-cols-[170px_170px_1fr_auto_auto]">
          {q.turno && <input type="hidden" name="turno" value={q.turno} />}
          {!q.turno && <input type="date" name="fecha" defaultValue={fecha} className="field" aria-label="Fecha" />}
          <select name="estado" defaultValue={q.estado ?? ""} className="field" aria-label="Estado">
            <option value="">Todas</option>
            <option value="completadas">Completadas</option>
            <option value="canceladas">Canceladas</option>
          </select>
          <input name="q" defaultValue={q.q} placeholder="Folio o cliente" className="field" aria-label="Buscar" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="marcadas" value="1" defaultChecked={q.marcadas === "1"} className="accent-primary" /> Con observaciones</label>
          <button className="min-h-11 rounded-app bg-primary px-4 text-sm font-medium text-primary-fg">Filtrar</button>
        </form>
      </Card>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Ventas" value={completed.length} hint={hasMore ? "en esta página" : undefined} />
        <Stat label="Total vendido" value={formatCents(total, cur)} />
        <Stat label="Ticket promedio" value={completed.length ? formatCents(Math.round(total / completed.length), cur) : "—"} />
      </div>
      {items.length === 0 ? (
        <EmptyState title="Sin ventas con esos filtros" />
      ) : (
        <Table>
          <thead><tr><th>Folio</th><th>Hora</th><th className="hidden sm:table-cell">Caja / cajero</th><th className="text-right">Total</th><th>Estado</th></tr></thead>
          <tbody>
            {items.map(({ sale: s, sellerName, registerName }) => (
              <tr key={s.id}>
                <td><Link className="link font-mono" href={`/ventas/${s.id}`}>{s.folio}</Link></td>
                <td className="whitespace-nowrap text-muted">{formatDateTime(s.soldAt, tz)}</td>
                <td className="hidden sm:table-cell">{registerName}<span className="block text-xs text-muted">{sellerName}</span></td>
                <td className="text-right font-medium">{formatCents(s.total, cur)}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {s.status === "cancelled" ? <Badge tone="danger">Cancelada</Badge> : <Badge tone="success">Completada</Badge>}
                    {s.origin === "offline" && <Badge tone="info">Sin conexión</Badge>}
                    {s.flags.length > 0 && <Badge tone="warning">{s.flags.length} observación{s.flags.length > 1 ? "es" : ""}</Badge>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <div className="mt-4 flex justify-between">
        {page > 1 ? <ButtonLink variant="secondary" href={qs({ p: String(page - 1) })}>← Anteriores</ButtonLink> : <span />}
        {hasMore && <ButtonLink variant="secondary" href={qs({ p: String(page + 1) })}>Siguientes →</ButtonLink>}
      </div>
    </>
  );
}
