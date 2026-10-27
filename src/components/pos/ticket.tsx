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
  /** Venta a crédito: importe cargado, saldo resultante y vencimiento. */
  credit?: { amount: number; balance: number | null; dueDate: string | null } | null;
  /** Promociones aplicadas con su explicación (p. ej. «2x1 Refrescos (2x1): −$18.50»). */
  promotions?: Array<{ description: string; amount: number }>;
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
      {!!t.promotions?.length && (
        <div className="my-1">
          <p className="font-bold">Promociones</p>
          {t.promotions.map((p, i) => <p key={i}>{p.description}</p>)}
        </div>
      )}
      {t.totals.discount > 0 && <div className="flex justify-between"><span>Ahorro</span><span>{money(t.totals.discount)}</span></div>}
      <div className="flex justify-between text-sm font-bold"><span>TOTAL</span><span>{money(t.totals.total)}</span></div>
      <hr className="my-2 border-dashed border-black" />
      {t.payments.map((p, i) => (
        <div key={i}>
          <div className="flex justify-between"><span>{p.name}{p.reference ? ` (${p.reference})` : ""}</span><span>{money(p.received ?? p.amount)}</span></div>
          {!!p.change && p.change > 0 && <div className="flex justify-between"><span>Cambio</span><span>{money(p.change)}</span></div>}
        </div>
      ))}
      {t.credit && (
        <>
          <hr className="my-2 border-dashed border-black" />
          <p className="font-bold">VENTA A CRÉDITO</p>
          <div className="flex justify-between"><span>Importe a crédito</span><span>{money(t.credit.amount)}</span></div>
          {t.credit.balance !== null && <div className="flex justify-between"><span>Saldo total</span><span>{money(t.credit.balance)}</span></div>}
          {t.credit.dueDate && <p>Vence: {t.credit.dueDate}</p>}
          <p className="mt-6 border-t border-black pt-1 text-center">Firma de conformidad · {t.customerName}</p>
        </>
      )}
      <hr className="my-2 border-dashed border-black" />
      <p className="text-center">Artículos: {formatQty(t.lines.reduce((a, l) => a + l.quantity, 0))}</p>
      <p className="mt-1 text-center">¡Gracias por su compra!</p>
      <p className="text-center">Este ticket no es un comprobante fiscal.</p>
    </div>
  );
}

export type AbonoTicketData = {
  company: TicketData["company"];
  branchName: string;
  folio: string;
  createdAt: string | Date;
  timezone: string;
  currency: string;
  cashierName: string;
  customer: { name: string; code: string };
  amount: number;
  methodName: string;
  received?: number | null;
  change?: number | null;
  reference?: string | null;
  balanceBefore: number;
  balanceAfter: number;
};

/** Comprobante de abono a la cuenta del cliente (80 mm). */
export function AbonoTicket({ t }: { t: AbonoTicketData }) {
  const when = new Intl.DateTimeFormat("es-MX", { timeZone: t.timezone, dateStyle: "short", timeStyle: "short" }).format(new Date(t.createdAt));
  const money = (c: number) => formatCents(c, t.currency);
  return (
    <div className="ticket mx-auto p-3" data-testid="abono-ticket">
      <div className="text-center">
        <p className="text-sm font-bold">{t.company.tradeName}</p>
        {t.company.taxId && <p>RFC {t.company.taxId}</p>}
        <p>{t.branchName}</p>
      </div>
      <hr className="my-2 border-dashed border-black" />
      <p className="text-center font-bold">COMPROBANTE DE ABONO</p>
      <p>Folio: <b>{t.folio}</b></p>
      <p>{when}</p>
      <p>Recibió: {t.cashierName}</p>
      <p>Cliente: {t.customer.name} ({t.customer.code})</p>
      <hr className="my-2 border-dashed border-black" />
      <div className="flex justify-between"><span>Saldo anterior</span><span>{money(t.balanceBefore)}</span></div>
      <div className="flex justify-between text-sm font-bold"><span>Abono</span><span>{money(t.amount)}</span></div>
      <div className="flex justify-between"><span>Saldo actual</span><span>{money(t.balanceAfter)}</span></div>
      <hr className="my-2 border-dashed border-black" />
      <div className="flex justify-between"><span>{t.methodName}{t.reference ? ` (${t.reference})` : ""}</span><span>{money(t.received ?? t.amount)}</span></div>
      {!!t.change && t.change > 0 && <div className="flex justify-between"><span>Cambio</span><span>{money(t.change)}</span></div>}
      <p className="mt-2 text-center">Conserve este comprobante.</p>
    </div>
  );
}

export type ReturnTicketData = {
  company: TicketData["company"];
  branchName: string;
  folio: string;
  saleFolio: string | null;
  createdAt: string | Date;
  timezone: string;
  currency: string;
  cashierName: string;
  customerName?: string | null;
  lines: Array<{ description: string; quantity: number; total: number; restock: boolean }>;
  total: number;
  refundLabel: string;
  /** Si se entregó vale: su folio es el de la devolución. */
  voucher?: { balance: number } | null;
};

/** Comprobante de devolución (80 mm). Si se entregó vale, el folio sirve para canjearlo. */
export function ReturnTicket({ t }: { t: ReturnTicketData }) {
  const when = new Intl.DateTimeFormat("es-MX", { timeZone: t.timezone, dateStyle: "short", timeStyle: "short" }).format(new Date(t.createdAt));
  const money = (c: number) => formatCents(c, t.currency);
  return (
    <div className="ticket mx-auto p-3" data-testid="return-ticket">
      <div className="text-center">
        <p className="text-sm font-bold">{t.company.tradeName}</p>
        {t.company.taxId && <p>RFC {t.company.taxId}</p>}
        <p>{t.branchName}</p>
      </div>
      <hr className="my-2 border-dashed border-black" />
      <p className="text-center font-bold">{t.voucher ? "DEVOLUCIÓN · VALE" : "COMPROBANTE DE DEVOLUCIÓN"}</p>
      <p>Folio: <b>{t.folio}</b></p>
      {t.saleFolio ? <p>Venta original: {t.saleFolio}</p> : <p>Sin ticket de venta</p>}
      <p>{when}</p>
      <p>Atendió: {t.cashierName}</p>
      {t.customerName && <p>Cliente: {t.customerName}</p>}
      <hr className="my-2 border-dashed border-black" />
      {t.lines.map((l, i) => (
        <div key={i} className="mb-1">
          <p>{l.description}{!l.restock && " (merma)"}</p>
          <div className="flex justify-between"><span>{formatQty(l.quantity)} pza.</span><span>{money(l.total)}</span></div>
        </div>
      ))}
      <hr className="my-2 border-dashed border-black" />
      <div className="flex justify-between text-sm font-bold"><span>TOTAL DEVUELTO</span><span>{money(t.total)}</span></div>
      <p>Reembolso: {t.refundLabel}</p>
      {t.voucher && (
        <>
          <hr className="my-2 border-dashed border-black" />
          <p className="text-center text-sm font-bold">VALE {t.folio}</p>
          <p className="text-center">Saldo disponible: {money(t.voucher.balance)}</p>
          <p className="text-center">Preséntelo al pagar. Se puede usar en varias compras.</p>
        </>
      )}
    </div>
  );
}
