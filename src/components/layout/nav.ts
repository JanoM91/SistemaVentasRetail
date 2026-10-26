import type { Permission } from "@/server/authz/permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: "home" | "building" | "store" | "users" | "shield" | "settings" | "scroll" | "server" | "cart" | "receipt" | "wallet" | "package" | "boxes";
  /** Sección del menú. */
  group?: "operacion" | "administracion";
  permission?: Permission;
};

/** Navegación principal. Cada entrada se muestra solo si el usuario tiene el permiso (y el módulo está activo). */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Inicio", icon: "home" },
  { href: "/pos", label: "Punto de venta", icon: "cart", permission: "pos.sell", group: "operacion" },
  { href: "/ventas", label: "Ventas", icon: "receipt", permission: "pos.sell", group: "operacion" },
  { href: "/caja", label: "Caja", icon: "wallet", permission: "cash.open", group: "operacion" },
  { href: "/catalogo", label: "Catálogo", icon: "package", permission: "catalog.view", group: "operacion" },
  { href: "/inventario", label: "Inventario", icon: "boxes", permission: "inventory.view", group: "operacion" },
  { group: "administracion", href: "/empresas", label: "Empresas", icon: "building", permission: "companies.view" },
  { group: "administracion", href: "/sucursales", label: "Sucursales", icon: "store", permission: "branches.view" },
  { group: "administracion", href: "/usuarios", label: "Usuarios", icon: "users", permission: "users.view" },
  { group: "administracion", href: "/roles", label: "Roles", icon: "shield", permission: "roles.view" },
  { group: "administracion", href: "/configuracion", label: "Configuración", icon: "settings", permission: "settings.view" },
  { group: "administracion", href: "/bitacora", label: "Bitácora", icon: "scroll", permission: "audit.view" },
  { group: "administracion", href: "/plataforma", label: "Plataforma", icon: "server", permission: "platform.tenants.manage" },
];
