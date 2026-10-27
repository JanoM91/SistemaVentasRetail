"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  Building2,
  Home,
  LogOut,
  Menu,
  Moon,
  ScrollText,
  Server,
  Settings,
  ShieldCheck,
  Store,
  Sun,
  Users,
  X,
  KeyRound,
  ShoppingCart,
  Receipt,
  Wallet,
  Package,
  Boxes,
  Truck,
  Contact,
  BadgePercent,
} from "lucide-react";
import { cx } from "@/components/ui";
import type { NavItem } from "./nav";

const ICONS = {
  home: Home,
  building: Building2,
  store: Store,
  users: Users,
  shield: ShieldCheck,
  settings: Settings,
  scroll: ScrollText,
  server: Server,
  cart: ShoppingCart,
  receipt: Receipt,
  wallet: Wallet,
  package: Package,
  boxes: Boxes,
  truck: Truck,
  contact: Contact,
  percent: BadgePercent,
};

export type ShellProps = {
  items: NavItem[];
  user: { fullName: string; username: string; roleName: string | null; isSuperadmin: boolean };
  company: { id: string; name: string } | null;
  branch: { id: string; name: string } | null;
  companies: Array<{ id: string; name: string }>;
  branches: Array<{ id: string; name: string }>;
  switchAction: (formData: FormData) => void | Promise<void>;
  logoutAction: () => void | Promise<void>;
  children: ReactNode;
};

export function AppShell({ items, user, company, branch, companies, branches, switchAction, logoutAction, children }: ShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="flex flex-col gap-1 p-3" aria-label="Principal">
      {items.map((item, idx) => {
        const Icon = ICONS[item.icon];
        const prev = items[idx - 1];
        const separator = prev && (prev.group ?? "inicio") !== (item.group ?? "inicio");
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <div key={item.href} className="contents">
          {separator && <div className="my-1 border-t border-border" role="separator" />}
          <Link
            href={item.href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex min-h-11 items-center gap-3 rounded-app px-3 text-sm font-medium transition",
              active ? "bg-primary/15 text-primary" : "text-text hover:bg-surface-2",
            )}
          >
            <Icon className="size-5 shrink-0" aria-hidden />
            {item.label}
          </Link>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      {/* Barra lateral (escritorio) */}
      <aside className="hidden w-60 shrink-0 border-r border-border bg-surface lg:block">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <span className="flex size-8 items-center justify-center rounded-app bg-primary font-bold text-primary-fg">$</span>
          <span className="font-semibold">Sistema de Caja</span>
        </div>
        {nav}
      </aside>

      {/* Cajón móvil */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-surface shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <span className="font-semibold">Sistema de Caja</span>
              <button className="rounded-app p-2 hover:bg-surface-2" onClick={() => setOpen(false)} aria-label="Cerrar menú">
                <X className="size-5" />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header data-app-header className="sticky top-0 z-30 flex min-h-14 items-center pt-[env(safe-area-inset-top)] gap-2 border-b border-border bg-surface px-3 sm:px-4">
          <button className="rounded-app p-2 hover:bg-surface-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menú">
            <Menu className="size-5" />
          </button>

          {company && (
            <form action={switchAction} className="flex min-w-0 flex-1 items-center gap-2">
              <select
                name="companyId"
                aria-label="Empresa activa"
                defaultValue={company.id}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                className="field !min-h-9 max-w-48 truncate !py-1 text-sm"
                disabled={companies.length <= 1}
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {branch && (
                <select
                  name="branchId"
                  aria-label="Sucursal activa"
                  defaultValue={branch.id}
                  onChange={(e) => e.currentTarget.form?.requestSubmit()}
                  className="field !min-h-9 hidden max-w-48 truncate !py-1 text-sm sm:block"
                  disabled={branches.length <= 1}
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}
            </form>
          )}
          {!company && <div className="flex-1 text-sm text-muted">{user.isSuperadmin ? "Plataforma" : "Sin empresa asignada"}</div>}

          <ThemeToggle />
          <UserMenu user={user} logoutAction={logoutAction} />
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof document === "undefined") return "light";
    return (document.documentElement.getAttribute("data-theme") as "light" | "dark") ?? "light";
  });
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("sc_theme", next);
    } catch {}
  }
  return (
    <button onClick={toggle} className="rounded-app p-2 hover:bg-surface-2" aria-label={theme === "dark" ? "Usar modo claro" : "Usar modo oscuro"} title="Cambiar tema">
      {theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  );
}

function UserMenu({ user, logoutAction }: { user: ShellProps["user"]; logoutAction: ShellProps["logoutAction"] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-9 items-center gap-2 rounded-app px-2 hover:bg-surface-2"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold">
          {user.fullName.slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-medium leading-tight">{user.fullName}</span>
          <span className="block text-xs text-muted leading-tight">{user.roleName ?? (user.isSuperadmin ? "Superadministrador" : "")}</span>
        </span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute right-0 z-40 mt-1 w-56 rounded-app border border-border bg-surface p-1 shadow-lg">
            <div className="px-3 py-2 text-xs text-muted">@{user.username}</div>
            <Link href="/cambiar-contrasena" role="menuitem" onClick={() => setOpen(false)} className="flex min-h-10 items-center gap-2 rounded-app px-3 text-sm hover:bg-surface-2">
              <KeyRound className="size-4" /> Cambiar contraseña
            </Link>
            <form action={logoutAction}>
              <button type="submit" role="menuitem" className="flex min-h-10 w-full items-center gap-2 rounded-app px-3 text-left text-sm hover:bg-surface-2">
                <LogOut className="size-4" /> Cerrar sesión
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
