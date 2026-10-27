import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert, Badge, PageHeader, Stat } from "@/components/ui";
import { ConfirmAction } from "@/components/ui/form";
import { PrintButton } from "@/components/print-button";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { NotFoundError } from "@/server/errors";
import { getCount } from "@/server/modules/inventory/operations";
import { formatCents } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { applyCountAction, cancelCountAction } from "../../actions";
import { COUNT_STATUS } from "../../traspasos/status";
import { CountCapture } from "./count-capture";

export const metadata: Metadata = { title: "Conteo físico" };

export default async function CountPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("inventory.view");
  const { id } = await params;
  let d;
  try {
    d = await getCount(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const c = d.count;
  const st = COUNT_STATUS[c.status];
  const open = c.status === "open";
  const canAuthorize = hasPermission(ctx, "inventory.authorize");
  const counted = d.lines.filter((l) => l.countedQty !== null);
  const withDiff = counted.filter((l) => l.difference);
  const value = withDiff.reduce((a, l) => a + (l.diffValue ?? 0), 0);
  const cur = ctx.company?.currency ?? "MXN";
  return (
    <>
      <PageHeader
        title={`Conteo ${c.folio}`}
        description={<>{d.branchName} · {d.warehouseName}{d.categoryName && ` · ${d.categoryName}`} · {formatDateTime(c.createdAt)} · <Badge tone={st.tone}>{st.label}</Badge></>}
        actions={
          <>
            <PrintButton label="Imprimir hoja" />
            {open && canAuthorize && (
              <ConfirmAction
                action={applyCountAction}
                label="Aplicar ajustes"
                variant="primary"
                confirmTitle="¿Aplicar el conteo?"
                confirmText={`Se ajustarán ${withDiff.length} producto(s)${d.showCost ? ` por ${formatCents(value, cur)}` : ""}. Los productos sin contar no se tocan. No se puede deshacer, solo corregir con otro movimiento.`}
                hiddenFields={{ id }}
              />
            )}
            {open && canAuthorize && <ConfirmAction action={cancelCountAction} label="Cancelar conteo" variant="danger" confirmTitle="¿Cancelar el conteo?" confirmText="No se ajusta nada." requireReason hiddenFields={{ id }} />}
          </>
        }
      />
      {open && !canAuthorize && <div className="mb-4"><Alert tone="info">Captura lo que cuentes y guarda. Un supervisor revisará las diferencias y aplicará el ajuste.</Alert></div>}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Productos" value={d.lines.length} />
        <Stat label="Contados" value={counted.length} hint={`${d.lines.length - counted.length} pendientes`} />
        {canAuthorize && <Stat label="Con diferencia" value={withDiff.length} />}
        {canAuthorize && d.showCost && <Stat label="Valor de la diferencia" value={formatCents(value, cur)} hint="a costo promedio" />}
      </div>
      <CountCapture countId={id} lines={d.lines} editable={open && hasPermission(ctx, "inventory.count")} review={canAuthorize || !open} currency={cur} />
    </>
  );
}
