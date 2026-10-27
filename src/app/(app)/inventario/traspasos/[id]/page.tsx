import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert, Badge, Card, Description, PageHeader, Table } from "@/components/ui";
import { ConfirmAction } from "@/components/ui/form";
import { PrintButton } from "@/components/print-button";
import { requirePagePermission } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { getTransfer } from "@/server/modules/inventory/operations";
import { formatQty } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { cancelTransferAction } from "../../actions";
import { TRANSFER_STATUS } from "../status";
import { ReceiveTransfer } from "./receive-transfer";

export const metadata: Metadata = { title: "Traspaso" };

export default async function TransferPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ nuevo?: string; recibido?: string }> }) {
  const ctx = await requirePagePermission("inventory.view");
  const { id } = await params;
  const { nuevo, recibido } = await searchParams;
  let d;
  try {
    d = await getTransfer(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const t = d.transfer;
  const st = TRANSFER_STATUS[t.status];
  const label = (l: (typeof d.lines)[number]) => `${l.name}${l.variantName ? ` · ${l.variantName}` : ""}`;
  return (
    <>
      <PageHeader
        title={`Traspaso ${t.folio}`}
        description={<>{d.fromBranchName} · {d.from.name} → {d.toBranchName} · {d.to?.name} · <Badge tone={st.tone}>{st.label}</Badge></>}
        actions={
          <>
            <PrintButton />
            {d.canCancel && <ConfirmAction action={cancelTransferAction} label="Cancelar envío" variant="danger" confirmTitle="¿Cancelar el traspaso?" confirmText="La mercancía regresa al almacén de origen." requireReason hiddenFields={{ id }} />}
          </>
        }
      />
      {nuevo && <div className="mb-4"><Alert tone="success" title="Traspaso enviado">La mercancía ya salió del origen. El destino debe confirmar lo que llegó.</Alert></div>}
      {recibido !== undefined && t.status === "received" && (
        <div className="mb-4">
          <Alert tone={recibido === "0" ? "success" : "warning"} title={recibido === "0" ? "Recibido completo" : `Recibido con ${recibido} diferencia(s)`}>
            {recibido !== "0" && "Las diferencias quedaron registradas en la bitácora; lo faltante no entra al destino."}
          </Alert>
        </div>
      )}
      {t.status === "in_transit" && !d.canReceive && <div className="mb-4"><Alert tone="info">Solo un usuario de {d.toBranchName} puede confirmar la recepción.</Alert></div>}
      {t.cancelReason && <div className="mb-4"><Alert tone="danger" title="Traspaso cancelado">{t.cancelReason}</Alert></div>}
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {t.status === "in_transit" && d.canReceive ? (
          <ReceiveTransfer transferId={id} lines={d.lines.map((l) => ({ id: l.l.id, label: label(l), sku: l.sku, sent: Number(l.l.quantitySent) }))} />
        ) : (
          <Card title="Productos">
            <Table className="border-0">
              <thead><tr><th>Producto</th><th className="text-right">Enviado</th><th className="text-right">Recibido</th></tr></thead>
              <tbody>
                {d.lines.map((l) => {
                  const sent = Number(l.l.quantitySent);
                  const rec = l.l.quantityReceived === null ? null : Number(l.l.quantityReceived);
                  return (
                    <tr key={l.l.id}>
                      <td><span className="block font-medium">{label(l)}</span><span className="font-mono text-xs text-muted">{l.sku}</span></td>
                      <td className="text-right">{formatQty(sent)}</td>
                      <td className="text-right">{rec === null ? "—" : <span className={rec !== sent ? "font-semibold text-danger" : ""}>{formatQty(rec)}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        )}
        <Card title="Datos">
          <Description
            items={[
              { label: "Envió", value: `${d.sentByName ?? ""} · ${formatDateTime(t.sentAt)}` },
              { label: "Recibió", value: t.receivedAt ? `${d.receivedByName ?? ""} · ${formatDateTime(t.receivedAt)}` : null },
              { label: "Canceló", value: t.cancelledAt ? `${d.cancelledByName ?? ""} · ${formatDateTime(t.cancelledAt)}` : null },
              { label: "Notas", value: t.notes },
              { label: "Notas de recepción", value: t.receiveNotes },
            ]}
          />
        </Card>
      </div>
    </>
  );
}
