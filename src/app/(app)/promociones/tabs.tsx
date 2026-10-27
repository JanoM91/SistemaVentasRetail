import { SectionTabs } from "@/components/section-tabs";

export function PromocionesTabs({ active }: { active: string }) {
  return <SectionTabs active={active} tabs={[{ href: "/promociones", label: "Promociones" }, { href: "/promociones/listas", label: "Listas de precios" }]} />;
}
