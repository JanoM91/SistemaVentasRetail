import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ButtonLink, PageHeader, Table } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { listTenants } from "@/server/modules/platform/service";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Plataforma" };

export default async function PlatformPage() {
  const ctx = await requirePagePermission("platform.tenants.manage");
  const tenants = await listTenants(ctx);
  return (
    <>
      <PageHeader title="Cuentas de la plataforma" description="Cada cuenta (tenant) es un negocio cliente con sus empresas, usuarios y datos aislados." actions={<ButtonLink href="/plataforma/nueva">Nueva cuenta</ButtonLink>} />
      <Table>
        <thead><tr><th>Nombre</th><th>Identificador</th><th className="hidden sm:table-cell">Empresas</th><th className="hidden sm:table-cell">Usuarios</th><th className="hidden md:table-cell">Creada</th><th>Estado</th></tr></thead>
        <tbody>
          {tenants.map(({ tenant, companyCount, userCount }) => (
            <tr key={tenant.id}>
              <td><Link className="link font-medium" href={`/plataforma/${tenant.id}`}>{tenant.name}</Link></td>
              <td className="font-mono text-xs">{tenant.slug}</td>
              <td className="hidden sm:table-cell">{companyCount}</td>
              <td className="hidden sm:table-cell">{userCount}</td>
              <td className="hidden text-muted md:table-cell">{formatDate(tenant.createdAt)}</td>
              <td>{tenant.status === "active" ? <Badge tone="success">Activa</Badge> : <Badge tone="danger">Suspendida</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
