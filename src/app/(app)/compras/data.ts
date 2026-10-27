import "server-only";
import type { RequestContext } from "@/server/context";
import { listSuppliers } from "@/server/modules/purchasing/service";
import { listAccessibleWarehouses } from "@/server/modules/inventory/service";

/** Opciones de proveedor y almacén para los formularios de compras. */
export async function purchaseFormOptions(ctx: RequestContext) {
  const [sup, whs] = await Promise.all([listSuppliers(ctx), listAccessibleWarehouses(ctx)]);
  return {
    suppliers: sup.map((r) => ({ id: r.s.id, name: r.s.name, paymentTermsDays: r.s.paymentTermsDays })),
    warehouses: whs.map((w) => ({ id: w.id, label: `${w.branchName} · ${w.name}`, branchId: w.branchId, isDefault: w.isDefault })),
  };
}

export const PO_STATUS = {
  draft: { tone: "neutral", label: "Borrador" },
  sent: { tone: "info", label: "Enviada" },
  partial: { tone: "warning", label: "Recibida parcial" },
  received: { tone: "success", label: "Cerrada" },
  cancelled: { tone: "danger", label: "Cancelada" },
} as const;
