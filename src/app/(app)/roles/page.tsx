import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ButtonLink, PageHeader, Table } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { listRoles } from "@/server/modules/roles/service";

export const metadata: Metadata = { title: "Roles" };

export default async function RolesPage() {
  const ctx = await requirePagePermission("roles.view");
  const roles = await listRoles(ctx);
  const canManage = hasPermission(ctx, "roles.manage");
  return (
    <>
      <PageHeader
        title="Roles y permisos"
        description="Los roles del sistema son plantillas fijas. Crea roles personalizados para ajustar permisos a tu operación."
        actions={canManage && <ButtonLink href="/roles/nuevo">Nuevo rol</ButtonLink>}
      />
      <Table>
        <thead><tr><th>Nombre</th><th className="hidden sm:table-cell">Clave</th><th>Tipo</th><th className="hidden md:table-cell">Permisos</th></tr></thead>
        <tbody>
          {roles.filter((r) => r.key !== "superadmin" || ctx.isSuperadmin).map((r) => (
            <tr key={r.id}>
              <td>
                <Link className="link font-medium" href={`/roles/${r.id}`}>{r.name}</Link>
                {r.description && <p className="text-xs text-muted">{r.description}</p>}
              </td>
              <td className="hidden font-mono text-xs sm:table-cell">{r.key}</td>
              <td>{r.isSystem ? <Badge tone="info">Sistema</Badge> : <Badge>Personalizado</Badge>}</td>
              <td className="hidden md:table-cell">{r.permissions.length}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
