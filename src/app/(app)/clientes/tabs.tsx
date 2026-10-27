import { SectionTabs } from "@/components/section-tabs";
import type { RequestContext } from "@/server/context";

export function ClientesTabs({ ctx, active }: { ctx: RequestContext; active: string }) {
  return (
    <SectionTabs
      active={active}
      tabs={[
        { href: "/clientes", label: "Clientes" },
        { href: "/clientes/por-cobrar", label: "Por cobrar", show: ctx.permissions.has("credit.view") },
        { href: "/clientes/grupos", label: "Grupos" },
      ]}
    />
  );
}
