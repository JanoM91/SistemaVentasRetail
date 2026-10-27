import { SectionTabs } from "@/components/section-tabs";
import type { RequestContext } from "@/server/context";

export function VentasTabs({ ctx, active }: { ctx: RequestContext; active: string }) {
  return (
    <SectionTabs
      active={active}
      tabs={[
        { href: "/ventas", label: "Ventas" },
        { href: "/ventas/devoluciones", label: "Devoluciones", show: ctx.permissions.has("returns.create") },
      ]}
    />
  );
}
