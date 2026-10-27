import { SectionTabs } from "@/components/section-tabs";

export function InventarioTabs({ active }: { active: string }) {
  return (
    <SectionTabs
      active={active}
      tabs={[
        { href: "/inventario", label: "Existencias" },
        { href: "/inventario/traspasos", label: "Traspasos" },
        { href: "/inventario/conteos", label: "Conteos físicos" },
      ]}
    />
  );
}
