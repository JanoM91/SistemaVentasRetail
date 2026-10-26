import type { Metadata } from "next";
import { Alert, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { listAssignableRoles } from "@/server/modules/roles/service";
import { listBranches } from "@/server/modules/branches/service";
import { UserCreateForm } from "../user-forms";

export const metadata: Metadata = { title: "Nuevo usuario" };

export default async function NewUserPage() {
  const ctx = await requirePagePermission("users.manage");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const [roles, branches] = await Promise.all([listAssignableRoles(ctx), listBranches(ctx)]);
  return (
    <>
      <PageHeader title="Nuevo usuario" description={`Tendrá acceso a ${ctx.company.tradeName} con el rol y las sucursales que elijas.`} />
      <UserCreateForm
        roles={roles.map((r) => ({ id: r.id, name: r.name, description: r.description }))}
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        canAssignAll={hasPermission(ctx, "branches.manage")}
      />
    </>
  );
}
