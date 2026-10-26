import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/shell";
import { NAV_ITEMS } from "@/components/layout/nav";
import { requireContext } from "@/server/context";
import { logoutAction, switchContextAction } from "./actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const path = (await headers()).get("x-pathname") ?? "";
  if (ctx.user.mustChangePassword && !path.startsWith("/cambiar-contrasena")) {
    redirect("/cambiar-contrasena");
  }
  const items = NAV_ITEMS.filter((i) => !i.permission || ctx.permissions.has(i.permission));
  const roleName = ctx.memberships.find((m) => m.companyId === ctx.company?.id)?.roleName ?? null;
  return (
    <AppShell
      items={items}
      user={{ fullName: ctx.user.fullName, username: ctx.user.username, roleName, isSuperadmin: ctx.user.isSuperadmin }}
      company={ctx.company ? { id: ctx.company.id, name: ctx.company.tradeName } : null}
      branch={ctx.branch ? { id: ctx.branch.id, name: ctx.branch.name } : null}
      companies={ctx.memberships.map((m) => ({ id: m.companyId, name: m.companyName }))}
      branches={ctx.branches.map((b) => ({ id: b.id, name: b.name }))}
      switchAction={switchContextAction}
      logoutAction={logoutAction}
    >
      {children}
    </AppShell>
  );
}
