import type { TicketData } from "@/components/pos/ticket";
import type { getSale } from "./service";

/** Convierte el detalle de una venta al formato del ticket. */
export function toTicketData(d: Awaited<ReturnType<typeof getSale>>): TicketData {
  return {
    company: { tradeName: d.company.tradeName, legalName: d.company.legalName, taxId: d.company.taxId, address: d.company.address as Record<string, string | undefined> },
    branch: { name: d.branch.name, address: Object.keys(d.branch.address ?? {}).length ? (d.branch.address as Record<string, string | undefined>) : null, phone: d.branch.phone },
    folio: d.sale.folio,
    soldAt: d.sale.soldAt,
    timezone: d.branch.timezone ?? d.company.timezone,
    sellerName: d.sellerName,
    registerName: d.registerName,
    currency: d.sale.currency,
    status: d.sale.status,
    lines: d.lines.map((l) => ({ description: l.description, sku: l.sku, quantity: Number(l.quantity), unitPrice: l.unitPrice, discount: l.discountAmount, total: l.lineTotal })),
    totals: { subtotal: d.sale.subtotal, tax: d.sale.taxTotal, discount: d.sale.discountTotal, total: d.sale.total },
    payments: d.payments.map(({ p, methodName }) => ({ name: methodName, amount: p.amount, received: p.received, change: p.change, reference: p.reference })),
    customerName: d.sale.customerName,
    credit: d.credit,
    promotions: d.promotions.filter((p) => p.status === "applied").map((p) => ({ description: p.description, amount: p.amount })),
  };
}
