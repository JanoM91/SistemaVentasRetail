import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { listRoles } from "@/server/modules/roles/service";
import { RoleForm } from "../role-form";
import { permissionGroups } from "../groups";
import { createRoleAction } from "../actions";

export const metadata: Metadata = { title: "Nuevo rol" };

export default async function NewRolePage({ searchParams }: { searchParams: Promise<{ desde?: string }> }) {
  const ctx = await requirePagePermission("roles.manage");
  const { desde } = await searchParams;
  const base = desde ? (await listRoles(ctx)).find((r) => r.id === desde) : undefined;
  return (
    <>
      <PageHeader title="Nuevo rol" description={base ? `Basado en "${base.name}". Ajusta nombre, clave y permisos.` : "Marca los permisos que tendrá el rol."} />
      <Card>
        <RoleForm action={createRoleAction} mode="create" groups={permissionGroups(ctx)} values={base ? { name: `${base.name} (copia)`, description: base.description, permissions: base.permissions } : {}} />
      </Card>
    </>
  );
}
