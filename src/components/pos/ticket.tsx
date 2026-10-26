import { formatCents, formatQty } from "@/lib/money";

export type TicketData = {
  company: { tradeName: string; legalName?: string | null; taxId?: string | null; address?: Record<string, string | undefined> | null };
  branch: { name: string; address?: Record<string, string | undefined> | null; phone?: string | null };
  folio: string | null;
  soldAt: string | Date;
  timezone: string;
  sellerName: string;
  registerName: string;
  currency: string;
  status: "completed" | "cancelled" | "pending";
  lines: Array<{ description: string; sku: string; quantity: number; unitPrice: number; discount: number; total: number }>;
  totals: { subtotal: number; tax: number; discount: number; total: number };
  payments: Array<{ name: string; amount: number; received?: number | null; change?: number | null; reference?: string | null }>;
  customerName?: string | null;
  offline?: boolean;
};

const addr = (a?: Record<string, string | undefined> | null) =>
  a ? [a.street && `${a.street} ${a.exteriorNumber ?? ""}`.trim(), a.neighborhood, a.city, a.state, a.postalCode && `C.P. ${a.postalCode}`].filter(Boolean).join(", ") : "";

/** Ticket de venta para impresora térmica de 80 mm (también se ve en pantalla). */
export function Ticket({ t }: { t: TicketData }) {
  const when = new Intl.DateTimeFormat("es-MX", { timeZone: t.timezone, dateStyle: "short", timeStyle: "short" }).format(new Date(t.soldAt));
  const money = (c: number) => formatCents(c, t.currency);
  return (
    <div className="ticket mx-auto p-3" data-testid="ticket">
      <div className="text-center">
        <p className="text-sm font-bold">{t.company.tradeName}</p>
        {t.company.legalName && t.company.legalName !== t.company.tradeName && <p>{t.company.legalName}</p>}
        {t.company.taxId && <p>RFC {t.company.taxId}</p>}
        <p>{t.branch.name}</p>
        {addr(t.branch.address ?? t.company.address) && <p>{addr(t.branch.address ?? t.company.address)}</p>}
        {t.branch.phone && <p>Tel. {t.branch.phone}</p>}
      </div>
      <hr className="my-2 border-dashed border-black" />
      <p>Folio: <b>{t.folio ?? "PENDIENTE"}</b></p>
      <p>{when}</p>
      <p>Caja: {t.registerName} · Atendió: {t.sellerName}</p>
      {t.customerName && <p>Cliente: {t.customerName}</p>}
      {t.status === "cancelled" && <p className="mt-1 text-center font-bold">*** VENTA CANCELADA ***</p>}
      {t.offline && <p className="mt-1 text-center">Venta sin conexión · folio al sincronizar</p>}
      <hr className="my-2 border-dashed border-black" />
      {t.lines.map((l, i) => (
        <div key={i} className="mb-1">
          <p>{l.description}</p>
          <div className="flex justify-between">
            <span>{formatQty(l.quantity)} × {money(l.unitPrice)}</span>
            <span>{money(l.total)}</span>
          </div>
          {l.discount > 0 && <p className="text-right">Descuento −{money(l.discount)}</p>}
        </div>
      ))}
      <hr className="my-2 border-dashed border-black" />
      <div className="flex justify-between"><span>Subtotal</span><span>{money(t.totals.subtotal)}</span></div>
      <div className="flex justify-between"><span>Impuestos</span><span>{money(t.totals.tax)}</span></div>
      {t.totals.discount > 0 && <div className="flex justify-between"><span>Ahorro</span><span>{money(t.totals.discount)}</span></div>}
      <div className="flex justify-between text-sm font-bold"><span>TOTAL</span><span>{money(t.totals.total)}</span></div>
      <hr className="my-2 border-dashed border-black" />
      {t.payments.map((p, i) => (
        <div key={i}>
          <div className="flex justify-between"><span>{p.name}{p.reference ? ` (${p.reference})` : ""}</span><span>{money(p.received ?? p.amount)}</span></div>
          {!!p.change && p.change > 0 && <div className="flex justify-between"><span>Cambio</span><span>{money(p.change)}</span></div>}
        </div>
      ))}
      <hr className="my-2 border-dashed border-black" />
      <p className="text-center">Artículos: {formatQty(t.lines.reduce((a, l) => a + l.quantity, 0))}</p>
      <p className="mt-1 text-center">¡Gracias por su compra!</p>
      <p className="text-center">Este ticket no es un comprobante fiscal.</p>
    </div>
  );
}
