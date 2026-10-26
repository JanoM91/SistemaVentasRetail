"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Alert, ButtonLink, Card } from "@/components/ui";
import { AppForm, Checkbox, ConfirmAction, FormField, Input, Select, SubmitButton } from "@/components/ui/form";
import { createUserAction, resetUserPasswordAction, setUserAccessAction } from "./actions";

type RoleOpt = { id: string; name: string; description: string | null };
type BranchOpt = { id: string; name: string };

export function TemporaryPasswordNotice({ username, password }: { username: string; password: string }) {
  return (
    <Alert tone="success" title="Contraseña temporal (se muestra una sola vez)">
      <p>
        Usuario <code className="rounded bg-surface-2 px-1">{username}</code> · Contraseña <code className="rounded bg-surface-2 px-1 font-mono text-base">{password}</code>
      </p>
      <p className="mt-1 text-xs">Entrégala en persona. Al iniciar sesión, el sistema pedirá cambiarla.</p>
    </Alert>
  );
}

function AccessFields({ roles, branches, canAssignAll, defaultRoleId, defaultBranchIds = [] }: { roles: RoleOpt[]; branches: BranchOpt[]; canAssignAll: boolean; defaultRoleId?: string | null; defaultBranchIds?: string[] }) {
  const [all, setAll] = useState(canAssignAll && defaultBranchIds.length === 0);
  return (
    <>
      <FormField name="roleId" label="Rol" required hint="Solo puedes asignar roles con permisos iguales o menores a los tuyos.">
        <Select name="roleId" defaultValue={defaultRoleId ?? ""}>
          <option value="">Elige un rol…</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}{r.description ? ` — ${r.description}` : ""}</option>
          ))}
        </Select>
      </FormField>
      <div className="space-y-2">
        <p className="text-sm font-medium">Sucursales</p>
        {canAssignAll && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-primary" checked={all} onChange={(e) => setAll(e.target.checked)} /> Todas las sucursales de la empresa (incluidas las futuras)
          </label>
        )}
        {!all && (
          <div className="grid gap-2 sm:grid-cols-2">
            {branches.map((b) => (
              <Checkbox key={b.id} name="branchIds[]" value={b.id} label={b.name} defaultChecked={defaultBranchIds.includes(b.id)} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function UserCreateForm({ roles, branches, canAssignAll }: { roles: RoleOpt[]; branches: BranchOpt[]; canAssignAll: boolean }) {
  const [created, setCreated] = useState<{ id: string; username: string; temporaryPassword: string | null } | null>(null);
  const onSuccess = useCallback((d: unknown) => setCreated(d as { id: string; username: string; temporaryPassword: string | null }), []);
  if (created) {
    return (
      <Card>
        {created.temporaryPassword ? <TemporaryPasswordNotice username={created.username} password={created.temporaryPassword} /> : <Alert tone="success">Usuario creado.</Alert>}
        <div className="mt-4 flex gap-2">
          <ButtonLink href={`/usuarios/${created.id}`}>Ver usuario</ButtonLink>
          <ButtonLink variant="secondary" href="/usuarios/nuevo">Crear otro</ButtonLink>
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <AppForm action={createUserAction} successMessage={null} onSuccess={onSuccess}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField name="fullName" label="Nombre completo" required><Input name="fullName" /></FormField>
          <FormField name="username" label="Usuario" required hint="Minúsculas, números, punto, guion o guion bajo."><Input name="username" autoCapitalize="none" /></FormField>
          <FormField name="email" label="Correo"><Input name="email" type="email" /></FormField>
          <FormField name="password" label="Contraseña" hint="Déjala vacía para generar una temporal."><Input name="password" type="text" autoComplete="off" /></FormField>
        </div>
        <AccessFields roles={roles} branches={branches} canAssignAll={canAssignAll} />
        <div className="flex gap-2">
          <SubmitButton>Crear usuario</SubmitButton>
          <ButtonLink variant="ghost" href="/usuarios">Cancelar</ButtonLink>
        </div>
      </AppForm>
    </Card>
  );
}

export function UserAccessForm({ userId, roles, branches, canAssignAll, roleId, branchIds }: { userId: string; roles: RoleOpt[]; branches: BranchOpt[]; canAssignAll: boolean; roleId: string | null; branchIds: string[] }) {
  return (
    <AppForm action={setUserAccessAction} successMessage="Acceso actualizado.">
      <input type="hidden" name="id" value={userId} />
      <AccessFields roles={roles} branches={branches} canAssignAll={canAssignAll} defaultRoleId={roleId} defaultBranchIds={branchIds} />
      <SubmitButton>Guardar acceso</SubmitButton>
    </AppForm>
  );
}

export function ResetPasswordButton({ userId, username }: { userId: string; username: string }) {
  const [result, setResult] = useState<{ temporaryPassword: string } | null>(null);
  return (
    <div className="space-y-3">
      {result && <TemporaryPasswordNotice username={username} password={result.temporaryPassword} />}
      <ConfirmAction
        action={resetUserPasswordAction}
        label="Restablecer contraseña"
        confirmTitle="¿Restablecer la contraseña?"
        confirmText="Se generará una contraseña temporal y se cerrarán todas las sesiones del usuario."
        hiddenFields={{ id: userId }}
        onDone={(d) => setResult(d as { temporaryPassword: string })}
      />
      <p className="text-xs text-muted">
        ¿Problemas? <Link className="link" href="/bitacora">Revisa la bitácora</Link>.
      </p>
    </div>
  );
}
