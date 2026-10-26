import type { DbOrTx } from "@/server/db";
import {
  branches,
  cashRegisters,
  companies,
  companyModules,
  documentSequences,
  MODULE_KEYS,
  paymentMethods,
  salesChannels,
  taxProfiles,
  warehouses,
  type ModuleKey,
} from "@/server/db/schema";
import type { CompanyInput } from "./validation";

/** Módulos encendidos por defecto para una empresa nueva. */
export const DEFAULT_MODULES: readonly ModuleKey[] = [
  "catalog",
  "inventory",
  "pos",
  "customers",
  "reports",
];

/**
 * Crea una empresa con su estructura mínima: sucursal, almacén, caja,
 * módulos, impuestos, métodos de pago, canal y folios por defecto.
 * Se ejecuta dentro de la transacción del llamador.
 */
export async function provisionCompany(
  conn: DbOrTx,
  input: {
    tenantId: string;
    company: CompanyInput;
    createdBy: string | null;
    branch?: { code?: string; name?: string };
    modules?: readonly ModuleKey[];
  },
) {
  const by = input.createdBy;
  const [company] = await conn
    .insert(companies)
    .values({
      tenantId: input.tenantId,
      code: input.company.code,
      legalName: input.company.legalName,
      tradeName: input.company.tradeName,
      taxId: input.company.taxId || null,
      taxRegime: input.company.taxRegime || null,
      currency: input.company.currency,
      timezone: input.company.timezone,
      locale: input.company.locale,
      dateFormat: input.company.dateFormat,
      address: input.company.address ?? {},
      settings: {
        inventory: { costingMethod: "average", allowNegativeStock: false },
        promotions: { allowStacking: false, maxDiscountPercent: 100 },
        pos: { allowSaleWithoutCustomer: true, requireCustomerForCredit: true },
      },
      createdBy: by,
      updatedBy: by,
    })
    .returning();

  const enabled = new Set(input.modules ?? DEFAULT_MODULES);
  await conn.insert(companyModules).values(
    MODULE_KEYS.map((module) => ({
      companyId: company.id,
      module,
      enabled: enabled.has(module),
      createdBy: by,
      updatedBy: by,
    })),
  );

  const [branch] = await conn
    .insert(branches)
    .values({
      tenantId: input.tenantId,
      companyId: company.id,
      code: input.branch?.code ?? "MATRIZ",
      name: input.branch?.name ?? "Matriz",
      createdBy: by,
      updatedBy: by,
    })
    .returning();

  const [warehouse] = await conn
    .insert(warehouses)
    .values({
      tenantId: input.tenantId,
      companyId: company.id,
      branchId: branch.id,
      code: `${branch.code}-ALM`,
      name: "Almacén principal",
      isDefault: true,
      createdBy: by,
      updatedBy: by,
    })
    .returning();

  const [register] = await conn
    .insert(cashRegisters)
    .values({
      tenantId: input.tenantId,
      companyId: company.id,
      branchId: branch.id,
      code: "CAJA1",
      name: "Caja 1",
      createdBy: by,
      updatedBy: by,
    })
    .returning();

  const isMexico = input.company.currency === "MXN";
  await conn.insert(taxProfiles).values(
    isMexico
      ? [
          { code: "IVA16", name: "IVA 16 %", kind: "iva" as const, rate: "0.160000", isDefault: true },
          { code: "IVA8", name: "IVA 8 % (frontera)", kind: "iva" as const, rate: "0.080000" },
          { code: "IVA0", name: "IVA 0 %", kind: "iva" as const, rate: "0.000000" },
          { code: "EXENTO", name: "Exento", kind: "otro" as const, rate: "0.000000" },
        ].map((t) => ({ ...t, tenantId: input.tenantId, companyId: company.id, isIncludedInPrice: true, createdBy: by, updatedBy: by }))
      : [
          { code: "TAX0", name: "Sin impuesto", kind: "otro" as const, rate: "0.000000", isDefault: true },
        ].map((t) => ({ ...t, tenantId: input.tenantId, companyId: company.id, isIncludedInPrice: true, createdBy: by, updatedBy: by })),
  );

  await conn.insert(paymentMethods).values(
    [
      { code: "EFECTIVO", name: "Efectivo", kind: "cash" as const, opensDrawer: true, allowsChange: true, sortOrder: 1 },
      { code: "TDC", name: "Tarjeta de crédito", kind: "card_credit" as const, requiresReference: true, sortOrder: 2 },
      { code: "TDD", name: "Tarjeta de débito", kind: "card_debit" as const, requiresReference: true, sortOrder: 3 },
      { code: "TRANSFER", name: "Transferencia", kind: "transfer" as const, requiresReference: true, sortOrder: 4 },
    ].map((m) => ({ ...m, tenantId: input.tenantId, companyId: company.id, provider: "manual", createdBy: by, updatedBy: by })),
  );

  await conn.insert(salesChannels).values({
    tenantId: input.tenantId,
    companyId: company.id,
    code: "TIENDA",
    name: "Tienda física",
    kind: "store",
    createdBy: by,
    updatedBy: by,
  });

  await conn.insert(documentSequences).values(
    (["sale", "quote", "return"] as const).map((documentType) => ({
      tenantId: input.tenantId,
      companyId: company.id,
      branchId: branch.id,
      documentType,
      series: documentType === "sale" ? "V" : documentType === "quote" ? "C" : "D",
      createdBy: by,
      updatedBy: by,
    })),
  );

  return { company, branch, warehouse, register };
}
