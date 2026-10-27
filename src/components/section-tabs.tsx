import Link from "next/link";
import { cx } from "@/components/ui";

/** Pestañas de sección (server). `active` es el href de la pestaña actual. */
export function SectionTabs({ tabs, active }: { tabs: Array<{ href: string; label: string; show?: boolean }>; active: string }) {
  const visible = tabs.filter((t) => t.show !== false);
  if (visible.length < 2) return null;
  return (
    <nav aria-label="Secciones" className="-mt-2 mb-5 flex gap-1 overflow-x-auto border-b border-border">
      {visible.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === active ? "page" : undefined}
          className={cx(
            "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition",
            t.href === active ? "border-primary text-primary" : "border-transparent text-muted hover:text-text",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
