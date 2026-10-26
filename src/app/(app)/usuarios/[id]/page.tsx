import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge, Card, Description, PageHeader } from "@/components/ui";
import { AppForm, ConfirmAction, FormField, Input, SubmitButton } from "@/components/ui/form";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { NotFoundError } from "@/server/errors";
import { getUser } from "@/server/modules/users/service";
import { listAssignableRoles } from "@/server/modules/roles/service";
import { listBranches } from "@/server/modules/branches/service";
import { formatDateTime } from "@/lib/format";
import { ResetPasswordButton, UserAccessForm } from "../user-forms";
import { setUserActiveAction, updateUserAction } from "../actions";

export const metadata: Metadata = { title: "Usuario" };

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("users.view");
  const { id } = await params;
  let user;
  try {
    user = await getUser(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const canManage = hasPermission(ctx, "users.manage");
  const isSelf = user.id === ctx.userId;
  const [roles, branches] = canManage ? await Promise.all([listAssignableRoles(ctx), listBranches(ctx)]) : [[], []];
  return (
    <>
      <PageHeader
        title={user.fullName}
        description={<>@{user.username} · {user.status === "active" ? <Badge tone="success">Activo</Badge> : <Badge tone="danger">Inactivo</Badge>}{isSelf && " · eres tú"}</>}
        actions={
          canManage && !isSelf && (
            <ConfirmAction
              action={setUserActiveAction}
              label={user.status === "active" ? "Desactivar" : "Reactivar"}
              variant={user.status === "active" ? "danger" : "secondary"}
              confirmTitle={user.status === "active" ? "¿Desactivar al usuario?" : "¿Reactivar al usuario?"}
              confirmText={user.status === "active" ? "Se cerrarán sus sesiones y no podrá entrar hasta reactivarlo." : undefined}
              requireReason={user.status === "active"}
              hiddenFields={{ id: user.id, active: user.status === "active" ? "false" : "true" }}
            />
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Datos">
          {canManage ? (
            <AppForm action={updateUserAction} successMessage="Datos actualizados.">
              <input type="hidden" name="id" value={user.id} />
              <FormField name="fullName" label="Nombre completo" required><Input name="fullName" defaultValue={user.fullName} /></FormField>
              <FormField name="email" label="Correo"><Input name="email" type="email" defaultValue={user.email ?? ""} /></FormField>
              <SubmitButton>Guardar</SubmitButton>
            </AppForm>
          ) : (
            <Description items={[{ label: "Correo", value: user.email }, { label: "Último acceso", value: formatDateTime(user.lastLoginAt, ctx.company?.timezone) }]} />
          )}
        </Card>

        <Card title={`Acceso en ${ctx.company?.tradeName}`}>
          {canManage && !isSelf ? (
            <UserAccessForm
              userId={user.id}
              roles={roles.map((r) => ({ id: r.id, name: r.name, description: r.description }))}
              branches={branches.map((b) => ({ id: b.id, name: b.name }))}
              canAssignAll={hasPermission(ctx, "branches.manage")}
              roleId={user.roleId}
              branchIds={user.branchIds}
            />
          ) : (
            <Description
              items={[
                { label: "Rol", value: user.roleName ?? "Sin rol" },
                { label: "Sucursales", value: user.branchIds.length === 0 ? "Todas" : user.branchIds.length },
              ]}
            />
          )}
          {isSelf && <p className="mt-3 text-xs text-muted">No puedes cambiar tu propio acceso; pídeselo a otro administrador.</p>}
        </Card>

        {canManage && !isSelf && (
          <Card title="Seguridad">
            <ResetPasswordButton userId={user.id} username={user.username} />
          </Card>
        )}
      </div>
    </>
  );
}
