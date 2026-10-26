import {
  ALL_PERMISSIONS,
  NON_PLATFORM_PERMISSIONS,
  type Permission,
} from "./permissions";

export type SystemRoleKey = "superadmin" | "owner" | "manager" | "cashier";

export type SystemRoleDef = {
  key: SystemRoleKey;
  name: string;
  description: string;
  permissions: readonly Permission[];
};

const managerExcluded = new Set<Permission>([
  "branches.manage",
  "companies.manage",
  "roles.manage",
  "settings.manage",
  "reports.schedule",
  "platform.tenants.manage",
]);

export const SYSTEM_ROLES: readonly SystemRoleDef[] = [
  {
    key: "superadmin",
    name: "Superadministrador",
    description: "Operación de la plataforma. Todos los permisos.",
    permissions: ALL_PERMISSIONS,
  },
  {
    key: "owner",
    name: "Dueño",
    description: "Todos los permisos sobre las empresas de su cuenta.",
    permissions: NON_PLATFORM_PERMISSIONS,
  },
  {
    key: "manager",
    name: "Gerente",
    description:
      "Operación completa de la sucursal: catálogo, inventario, ventas, caja, compras, clientes, reportes y usuarios de su alcance.",
    permissions: NON_PLATFORM_PERMISSIONS.filter((p) => !managerExcluded.has(p)),
  },
  {
    key: "cashier",
    name: "Cajero",
    description:
      "Vender, cobrar, abrir y cerrar su caja. Sin acceso a costos, utilidades ni configuración.",
    permissions: [
      "catalog.view",
      "inventory.view",
      "pos.sell",
      "pos.quote",
      "cash.open",
      "cash.close",
      "cash.withdraw",
      "cash.deposit",
      "customers.view",
      "customers.manage",
      "returns.create",
      "invoicing.issue",
      "loyalty.view",
      "credit.view",
    ],
  },
];

export const SYSTEM_ROLE_BY_KEY: Record<SystemRoleKey, SystemRoleDef> =
  Object.fromEntries(SYSTEM_ROLES.map((r) => [r.key, r])) as Record<
    SystemRoleKey,
    SystemRoleDef
  >;
