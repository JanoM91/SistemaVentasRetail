import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, ButtonLink, EmptyState, PageHeader, Table } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { listUsers } from "@/server/modules/users/service";
import { listBranches } from "@/server/modules/branches/service";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Usuarios" };

export default async function UsersPage() {
  const ctx = await requirePagePermission("users.view");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa para ver sus usuarios.</Alert>;
  const canManage = hasPermission(ctx, "users.manage");
  const [users, branches] = await Promise.all([listUsers(ctx), listBranches(ctx, { includeInactive: true })]);
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? "?";
  return (
    <>
      <PageHeader
        title="Usuarios"
        description={`Personas con acceso a ${ctx.company.tradeName}.`}
        actions={canManage && <ButtonLink href="/usuarios/nuevo">Nuevo usuario</ButtonLink>}
      />
      {users.length === 0 ? (
        <EmptyState title="Sin usuarios visibles" />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th className="hidden sm:table-cell">Usuario</th>
              <th>Rol</th>
              <th className="hidden md:table-cell">Sucursales</th>
              <th className="hidden lg:table-cell">Último acceso</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><Link className="link font-medium" href={`/usuarios/${u.id}`}>{u.fullName}</Link></td>
                <td className="hidden font-mono text-xs sm:table-cell">@{u.username}</td>
                <td>{u.roleName ?? <span className="text-muted">Sin rol en esta empresa</span>}</td>
                <td className="hidden text-muted md:table-cell">{u.branchIds.length === 0 ? "Todas" : u.branchIds.map(branchName).join(", ")}</td>
                <td className="hidden text-muted lg:table-cell">{formatDateTime(u.lastLoginAt, ctx.company?.timezone)}</td>
                <td>{u.status === "active" ? <Badge tone="success">Activo</Badge> : <Badge tone="danger">Inactivo</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
