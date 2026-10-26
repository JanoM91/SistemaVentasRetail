import type { Permission } from "@/server/authz/permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: "home" | "building" | "store" | "users" | "shield" | "settings" | "scroll" | "server";
  permission?: Permission;
};

/** Navegación de la Fase 2. Los módulos operativos (catálogo, POS…) se añaden en fases posteriores. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Inicio", icon: "home" },
  { href: "/empresas", label: "Empresas", icon: "building", permission: "companies.view" },
  { href: "/sucursales", label: "Sucursales", icon: "store", permission: "branches.view" },
  { href: "/usuarios", label: "Usuarios", icon: "users", permission: "users.view" },
  { href: "/roles", label: "Roles", icon: "shield", permission: "roles.view" },
  { href: "/configuracion", label: "Configuración", icon: "settings", permission: "settings.view" },
  { href: "/bitacora", label: "Bitácora", icon: "scroll", permission: "audit.view" },
  { href: "/plataforma", label: "Plataforma", icon: "server", permission: "platform.tenants.manage" },
];
