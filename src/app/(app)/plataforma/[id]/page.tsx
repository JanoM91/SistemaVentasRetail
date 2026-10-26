import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Badge, Card, Description, PageHeader, Table } from "@/components/ui";
import { ConfirmAction } from "@/components/ui/form";
import { requirePagePermission } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { getTenantDetail } from "@/server/modules/platform/service";
import { db } from "@/server/db";
import { companyModules, MODULE_KEYS } from "@/server/db/schema";
import { formatDateTime } from "@/lib/format";
import { OwnerResetButton, TenantCompanyModulesForm } from "../forms";
import { setTenantStatusAction } from "../actions";

export const metadata: Metadata = { title: "Cuenta" };

export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("platform.tenants.manage");
  const { id } = await params;
  let detail;
  try {
    detail = await getTenantDetail(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { tenant, companies, owners } = detail;
  const modulesByCompany = new Map<string, Array<{ module: string; enabled: boolean }>>();
  for (const c of companies) {
    const rows = await db.select().from(companyModules).where(eq(companyModules.companyId, c.id));
    const on = new Set(rows.filter((r) => r.enabled).map((r) => r.module));
    modulesByCompany.set(c.id, MODULE_KEYS.map((m) => ({ module: m, enabled: on.has(m) })));
  }
  const suspended = tenant.status === "suspended";
  return (
    <>
      <PageHeader
        title={tenant.name}
        description={<>Identificador {tenant.slug} · {suspended ? <Badge tone="danger">Suspendida</Badge> : <Badge tone="success">Activa</Badge>}</>}
        actions={
          <ConfirmAction
            action={setTenantStatusAction}
            label={suspended ? "Reactivar cuenta" : "Suspender cuenta"}
            variant={suspended ? "secondary" : "danger"}
            confirmTitle={suspended ? "¿Reactivar la cuenta?" : "¿Suspender la cuenta?"}
            confirmText={suspended ? "Sus usuarios podrán volver a entrar." : "Se cerrarán todas las sesiones y nadie podrá iniciar sesión hasta reactivarla."}
            requireReason={!suspended}
            hiddenFields={{ id: tenant.id, status: suspended ? "active" : "suspended" }}
          />
        }
      />
      <div className="space-y-6">
        <Card title="Datos">
          <Description items={[{ label: "País", value: tenant.country }, { label: "Moneda", value: tenant.defaultCurrency }, { label: "Zona horaria", value: tenant.defaultTimezone }, { label: "Plan", value: tenant.plan }, { label: "Creada", value: formatDateTime(tenant.createdAt) }]} />
        </Card>
        <Card title="Dueños">
          <Table>
            <thead><tr><th>Nombre</th><th>Usuario</th><th>Correo</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {owners.map((o) => (
                <tr key={o.id}>
                  <td>{o.fullName}</td>
                  <td className="font-mono text-xs">@{o.username}</td>
                  <td className="text-muted">{o.email ?? "—"}</td>
                  <td>{o.status === "active" ? <Badge tone="success">Activo</Badge> : <Badge tone="danger">Inactivo</Badge>}</td>
                  <td className="text-right"><OwnerResetButton tenantId={tenant.id} userId={o.id} username={o.username} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        {companies.map((c) => (
          <Card key={c.id} title={`Empresa: ${c.tradeName} (${c.code})`}>
            <p className="mb-3 text-sm text-muted">Módulos activos para esta empresa. El dueño también puede cambiarlos desde Configuración.</p>
            <TenantCompanyModulesForm tenantId={tenant.id} companyId={c.id} modules={modulesByCompany.get(c.id) ?? []} />
          </Card>
        ))}
      </div>
    </>
  );
}
