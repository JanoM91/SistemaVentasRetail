import Link from "next/link";
import { Alert, Badge, Card, Description, PageHeader, Stat, Table } from "@/components/ui";
import { requireContext } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { listCompanies } from "@/server/modules/companies/service";
import { listBranches } from "@/server/modules/branches/service";
import { listUsers } from "@/server/modules/users/service";
import { queryAudit } from "@/server/audit";
import { AREA_LABELS } from "@/server/authz/permissions";
import { formatDateTime } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { getSummary, reportFilter } from "@/server/modules/reports/service";
import { Kpi } from "./reportes/kpi";

export default async function HomePage() {
  const ctx = await requireContext();
  const canCompanies = hasPermission(ctx, "companies.view");
  const canBranches = hasPermission(ctx, "branches.view");
  const canUsers = hasPermission(ctx, "users.view");
  const canAudit = hasPermission(ctx, "audit.view");
  const canReports = hasPermission(ctx, "reports.view") && !!ctx.company;
  const today = canReports ? await getSummary(reportFilter(ctx, { periodo: "hoy" })) : null;

  const [companies, branches, users, audit] = await Promise.all([
    canCompanies ? listCompanies(ctx) : [],
    canBranches && ctx.company ? listBranches(ctx) : [],
    canUsers && ctx.company ? listUsers(ctx) : [],
    canAudit ? queryAudit({ tenantId: ctx.tenantId, companyId: ctx.company?.id, limit: 8 }) : { items: [], hasMore: false },
  ]);

  const modules = [...ctx.enabledModules].map((m) => AREA_LABELS[m]);

  return (
    <>
      <PageHeader
        title={`Hola, ${ctx.user.fullName.split(" ")[0]}`}
        description={ctx.company ? `${ctx.company.tradeName}${ctx.branch ? ` · ${ctx.branch.name}` : ""}` : "Plataforma"}
      />

      {!ctx.company && !ctx.isSuperadmin && (
        <Alert tone="warning" title="No tienes una empresa asignada">
          Pide a un administrador que te asigne un rol en alguna empresa.
        </Alert>
      )}

      {today && ctx.company && (
        <Card title="Hoy" className="mb-6" actions={<Link className="link text-sm" href="/reportes">Ver reportes</Link>}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="home-today">
            <Kpi label="Venta neta" value={formatCents(today.current.netSales, ctx.company.currency)} current={today.current.netSales} previous={today.previous.netSales} />
            <Kpi label="Tickets" value={today.current.tickets} current={today.current.tickets} previous={today.previous.tickets} />
            <Kpi label="Ticket promedio" value={formatCents(today.current.avgTicket, ctx.company.currency)} current={today.current.avgTicket} previous={today.previous.avgTicket} />
            <Kpi label="Devoluciones" value={formatCents(today.current.returnsTotal, ctx.company.currency)} current={today.current.returnsTotal} previous={today.previous.returnsTotal} />
          </div>
          <p className="mt-2 text-xs text-muted">Comparado con ayer, todas tus sucursales.</p>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {canCompanies && <Stat label="Empresas" value={companies.filter((c) => !c.deactivatedAt).length} hint="activas en tu cuenta" />}
        {canBranches && ctx.company && <Stat label="Sucursales" value={branches.length} hint="activas que puedes ver" />}
        {canUsers && ctx.company && <Stat label="Usuarios" value={users.filter((u) => u.status === "active").length} hint="activos en esta empresa" />}
        {ctx.company && <Stat label="Módulos activos" value={modules.length} hint={modules.join(", ") || "ninguno"} />}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card title="Tu acceso" className="lg:col-span-1">
          <Description
            items={[
              { label: "Usuario", value: `@${ctx.user.username}` },
              { label: "Rol", value: ctx.memberships.find((m) => m.companyId === ctx.company?.id)?.roleName ?? (ctx.isSuperadmin ? "Superadministrador" : "—") },
              { label: "Sucursal activa", value: ctx.branch?.name ?? "—" },
              { label: "Permisos efectivos", value: ctx.permissions.size },
            ]}
          />
          {ctx.isSuperadmin && (
            <p className="mt-4 text-sm">
              <Link className="link" href="/plataforma">
                Ir a la administración de la plataforma →
              </Link>
            </p>
          )}
        </Card>

        {canAudit && (
          <Card title="Actividad reciente" className="lg:col-span-2" actions={<Link className="link text-sm" href="/bitacora">Ver bitácora</Link>}>
            {audit.items.length === 0 ? (
              <p className="text-sm text-muted">Sin actividad registrada todavía.</p>
            ) : (
              <Table className="border-0">
                <tbody>
                  {audit.items.map((i) => (
                    <tr key={i.entry.id}>
                      <td className="whitespace-nowrap text-muted">{formatDateTime(i.entry.createdAt, ctx.company?.timezone)}</td>
                      <td>
                        <Badge>{i.entry.action}</Badge>
                      </td>
                      <td className="text-muted">{i.userFullName ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        )}
      </div>

      <div className="mt-6">
      <Alert tone="info" title="Estado del producto: Fase 2 (base técnica)">
        Esta versión incluye cuentas, empresas, sucursales, almacenes, cajas, usuarios, roles, configuración y bitácora. El catálogo, el inventario y el punto de venta llegan en la Fase 3.
      </Alert>
      </div>
    </>
  );
}
