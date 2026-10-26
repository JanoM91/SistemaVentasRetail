import type { ModuleKey } from "@/server/db/schema/common";

/**
 * Catálogo de permisos: única fuente de verdad (ver docs/03-roles-y-permisos.md).
 * Cada permiso pertenece a un "área". Si el área corresponde a un módulo
 * activable por empresa, el permiso solo es efectivo cuando el módulo está activo.
 */
export type PermissionArea =
  | "platform"
  | "settings"
  | "companies"
  | "branches"
  | "users"
  | "roles"
  | "audit"
  | "cash"
  | ModuleKey;

export type PermissionDef = {
  code: string;
  area: PermissionArea;
  label: string;
};

const def = (area: PermissionArea, action: string, label: string) => ({
  code: `${area}.${action}`,
  area,
  label,
});

export const PERMISSIONS = [
  def("platform", "tenants.manage", "Administrar tenants de la plataforma"),

  def("settings", "view", "Ver configuración"),
  def("settings", "manage", "Cambiar configuración"),

  def("companies", "view", "Ver empresas"),
  def("companies", "manage", "Crear y editar empresas"),

  def("branches", "view", "Ver sucursales, almacenes y cajas"),
  def("branches", "manage", "Crear y editar sucursales, almacenes y cajas"),

  def("users", "view", "Ver usuarios"),
  def("users", "manage", "Crear y editar usuarios"),

  def("roles", "view", "Ver roles"),
  def("roles", "manage", "Crear y editar roles"),

  def("audit", "view", "Consultar bitácora"),

  def("catalog", "view", "Ver catálogo"),
  def("catalog", "create", "Crear productos"),
  def("catalog", "edit", "Editar productos"),
  def("catalog", "disable", "Desactivar productos"),
  def("catalog", "edit_price", "Modificar precios"),
  def("catalog", "view_cost", "Ver costos"),
  def("catalog", "import", "Importar productos"),

  def("inventory", "view", "Ver existencias"),
  def("inventory", "adjust", "Registrar ajustes y movimientos"),
  def("inventory", "transfer", "Traspasos"),
  def("inventory", "count", "Conteos físicos"),
  def("inventory", "authorize", "Autorizar ajustes"),
  def("inventory", "view_cost", "Ver costos de inventario"),

  def("pos", "sell", "Vender"),
  def("pos", "discount", "Aplicar descuentos"),
  def("pos", "edit_price", "Modificar precio en venta"),
  def("pos", "cancel", "Cancelar ventas"),
  def("pos", "reopen", "Reabrir ventas"),
  def("pos", "reprint", "Reimprimir tickets"),
  def("pos", "credit_sale", "Vender a crédito"),
  def("pos", "quote", "Cotizar"),

  def("cash", "open", "Abrir caja"),
  def("cash", "close", "Cerrar caja"),
  def("cash", "withdraw", "Retiros de efectivo"),
  def("cash", "deposit", "Depósitos de efectivo"),
  def("cash", "view_differences", "Ver diferencias de caja"),
  def("cash", "close_any", "Cerrar la caja de otro usuario"),

  def("purchases", "view", "Ver compras"),
  def("purchases", "create", "Crear órdenes de compra"),
  def("purchases", "authorize", "Autorizar compras"),
  def("purchases", "receive", "Recibir mercancía"),
  def("purchases", "return", "Devolver a proveedor"),

  def("customers", "view", "Ver clientes"),
  def("customers", "manage", "Crear y editar clientes"),
  def("customers", "export", "Exportar clientes"),
  def("customers", "credit_manage", "Administrar límites de crédito"),

  def("promotions", "view", "Ver promociones"),
  def("promotions", "manage", "Crear y editar promociones"),

  def("returns", "create", "Registrar devoluciones"),
  def("returns", "authorize", "Autorizar devoluciones"),
  def("returns", "no_ticket", "Devoluciones sin ticket"),

  def("invoicing", "view", "Ver facturas"),
  def("invoicing", "issue", "Emitir facturas"),
  def("invoicing", "cancel", "Cancelar facturas"),

  def("reports", "view", "Ver reportes"),
  def("reports", "view_profit", "Ver costos, márgenes y utilidades"),
  def("reports", "export", "Exportar reportes"),
  def("reports", "schedule", "Programar reportes"),

  def("channels", "view", "Ver canales"),
  def("channels", "manage", "Administrar canales"),
  def("channels", "orders_manage", "Administrar pedidos"),

  def("loyalty", "view", "Ver lealtad"),
  def("loyalty", "manage", "Administrar lealtad"),

  def("credit", "view", "Ver cuentas por cobrar"),
  def("credit", "manage", "Administrar cuentas por cobrar"),
] as const satisfies readonly PermissionDef[];

export type Permission = (typeof PERMISSIONS)[number]["code"];

export const PERMISSION_CODES: readonly Permission[] = PERMISSIONS.map(
  (p) => p.code,
);
const PERMISSION_SET = new Set<string>(PERMISSION_CODES);

export function isPermission(code: string): code is Permission {
  return PERMISSION_SET.has(code);
}

export function permissionArea(code: Permission): PermissionArea {
  return code.split(".")[0] as PermissionArea;
}

/** Áreas que no dependen de un módulo activable (siempre disponibles). */
export const CORE_AREAS: readonly PermissionArea[] = [
  "platform",
  "settings",
  "companies",
  "branches",
  "users",
  "roles",
  "audit",
];

/** El área `cash` depende del módulo `pos`. */
const AREA_TO_MODULE: Partial<Record<PermissionArea, ModuleKey>> = {
  cash: "pos",
};

export function moduleForArea(area: PermissionArea): ModuleKey | null {
  if (CORE_AREAS.includes(area)) return null;
  if (area in AREA_TO_MODULE) return AREA_TO_MODULE[area]!;
  return area as ModuleKey;
}

export const ALL_PERMISSIONS = PERMISSION_CODES;
export const NON_PLATFORM_PERMISSIONS = PERMISSION_CODES.filter(
  (c) => permissionArea(c) !== "platform",
);

/** Etiquetas de área para la interfaz. */
export const AREA_LABELS: Record<PermissionArea, string> = {
  platform: "Plataforma",
  settings: "Configuración",
  companies: "Empresas",
  branches: "Sucursales",
  users: "Usuarios",
  roles: "Roles",
  audit: "Bitácora",
  catalog: "Catálogo",
  inventory: "Inventario",
  pos: "Punto de venta",
  cash: "Caja",
  purchases: "Compras",
  customers: "Clientes",
  promotions: "Promociones",
  returns: "Devoluciones",
  invoicing: "Facturación",
  reports: "Reportes",
  channels: "Canales y pedidos",
  loyalty: "Lealtad",
  credit: "Crédito",
};
