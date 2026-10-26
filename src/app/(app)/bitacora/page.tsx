import type { Metadata } from "next";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Table } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { queryAudit } from "@/server/audit";
import { listUsers } from "@/server/modules/users/service";
import { hasPermission } from "@/server/authz/guard";
import { formatDateTime } from "@/lib/format";
import { AuditDetails } from "./details";

export const metadata: Metadata = { title: "Bitácora" };

const PAGE = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePagePermission("audit.view");
  const q = await searchParams;
  const page = Math.max(1, Number(q.p ?? 1));
  const canSeeAllBranches = hasPermission(ctx, "branches.manage");
  const result = await queryAudit({
    tenantId: ctx.tenantId,
    companyId: ctx.company?.id ?? null,
    branchIds: canSeeAllBranches ? null : ctx.branches.map((b) => b.id),
    userId: q.usuario || null,
    action: q.accion || null,
    entity: q.entidad || null,
    from: q.desde ? new Date(q.desde) : null,
    to: q.hasta ? new Date(`${q.hasta}T23:59:59`) : null,
    limit: PAGE,
    offset: (page - 1) * PAGE,
  });
  const users = hasPermission(ctx, "users.view") && ctx.company ? await listUsers(ctx) : [];
  const qs = (overrides: Record<string, string>) => {
    const params = new URLSearchParams({ ...Object.fromEntries(Object.entries(q).filter(([, v]) => v)) as Record<string, string>, ...overrides });
    return `/bitacora?${params.toString()}`;
  };
  return (
    <>
      <PageHeader title="Bitácora" description="Acciones críticas con usuario, fecha, sucursal, dispositivo, motivo y datos anteriores/nuevos. Solo lectura." />
      <Card className="mb-4">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-sm">Desde<input type="date" name="desde" defaultValue={q.desde} className="field mt-1" /></label>
          <label className="text-sm">Hasta<input type="date" name="hasta" defaultValue={q.hasta} className="field mt-1" /></label>
          <label className="text-sm">Usuario
            <select name="usuario" defaultValue={q.usuario ?? ""} className="field mt-1">
              <option value="">Todos</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
            </select>
          </label>
          <label className="text-sm">Acción<input name="accion" defaultValue={q.accion} placeholder="p. ej. users.create" className="field mt-1" /></label>
          <div className="flex items-end gap-2">
            <button type="submit" className="min-h-11 flex-1 rounded-app bg-primary px-4 text-sm font-medium text-primary-fg">Filtrar</button>
            <ButtonLink variant="ghost" href="/bitacora">Limpiar</ButtonLink>
          </div>
        </form>
      </Card>
      {result.items.length === 0 ? (
        <EmptyState title="Sin registros con esos filtros" />
      ) : (
        <Table>
          <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th className="hidden md:table-cell">Entidad</th><th className="hidden lg:table-cell">Motivo</th><th>Detalle</th></tr></thead>
          <tbody>
            {result.items.map(({ entry, userFullName, userName }) => (
              <tr key={entry.id}>
                <td className="whitespace-nowrap text-muted">{formatDateTime(entry.createdAt, ctx.company?.timezone)}</td>
                <td>{userFullName ?? "—"}{userName && <span className="block text-xs text-muted">@{userName}</span>}</td>
                <td><Badge tone={entry.action.includes("fail") || entry.action.includes("locked") ? "danger" : "neutral"}>{entry.action}</Badge></td>
                <td className="hidden font-mono text-xs md:table-cell">{entry.entity}{entry.entityId && <span className="block text-muted">{entry.entityId.slice(0, 8)}…</span>}</td>
                <td className="hidden text-muted lg:table-cell">{entry.reason ?? "—"}</td>
                <td><AuditDetails before={entry.before} after={entry.after} meta={{ ip: entry.ip, userAgent: entry.userAgent, deviceId: entry.deviceId, authorizedBy: entry.authorizedByUserId }} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <div className="mt-4 flex justify-between">
        {page > 1 ? <ButtonLink variant="secondary" href={qs({ p: String(page - 1) })}>← Anteriores</ButtonLink> : <span />}
        {result.hasMore && <ButtonLink variant="secondary" href={qs({ p: String(page + 1) })}>Siguientes →</ButtonLink>}
      </div>
    </>
  );
}
