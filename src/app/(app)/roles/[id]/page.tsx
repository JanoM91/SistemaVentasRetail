import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { ConfirmAction } from "@/components/ui/form";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { NotFoundError } from "@/server/errors";
import { getRole } from "@/server/modules/roles/service";
import { RoleForm } from "../role-form";
import { permissionGroups } from "../groups";
import { deactivateRoleAction, updateRoleAction } from "../actions";

export const metadata: Metadata = { title: "Rol" };

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("roles.view");
  const { id } = await params;
  let role;
  try {
    role = await getRole(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const canManage = hasPermission(ctx, "roles.manage");
  const readOnly = role.isSystem || !canManage;
  return (
    <>
      <PageHeader
        title={role.name}
        description={<>Clave {role.key} · {role.isSystem ? <Badge tone="info">Rol del sistema (solo lectura)</Badge> : <Badge>Personalizado</Badge>}</>}
        actions={
          canManage && (
            <>
              <ButtonLink variant="secondary" href={`/roles/nuevo?desde=${role.id}`}>Duplicar</ButtonLink>
              {!role.isSystem && (
                <ConfirmAction action={deactivateRoleAction} label="Desactivar" variant="danger" confirmTitle="¿Desactivar el rol?" confirmText="Solo es posible si ningún usuario lo tiene asignado." requireReason hiddenFields={{ id: role.id }} />
              )}
            </>
          )
        }
      />
      <Card>
        <RoleForm action={updateRoleAction} mode="edit" readOnly={readOnly} groups={permissionGroups(ctx)} values={{ id: role.id, key: role.key, name: role.name, description: role.description, permissions: role.permissions }} />
      </Card>
    </>
  );
}
