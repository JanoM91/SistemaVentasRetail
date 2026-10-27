import { SectionTabs } from "@/components/section-tabs";
import type { RequestContext } from "@/server/context";

export function ComprasTabs({ ctx, active }: { ctx: RequestContext; active: string }) {
  const p = (x: string) => ctx.permissions.has(x as never);
  return (
    <SectionTabs
      active={active}
      tabs={[
        { href: "/compras", label: "Órdenes" },
        { href: "/compras/recepciones", label: "Recepciones" },
        { href: "/compras/por-pagar", label: "Por pagar" },
        { href: "/compras/sugerencias", label: "Sugerencias", show: p("purchases.create") },
        { href: "/compras/devoluciones", label: "Devoluciones" },
        { href: "/compras/proveedores", label: "Proveedores" },
      ]}
    />
  );
}
