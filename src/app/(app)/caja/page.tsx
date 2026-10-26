import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, ButtonLink, Card, EmptyState, PageHeader, Table } from "@/components/ui";
import { AppForm, FormField, Input, SubmitButton } from "@/components/ui/form";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { listRegistersWithStatus, listSessions } from "@/server/modules/cash/service";
import { formatCents } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { openSessionAction } from "./actions";

export const metadata: Metadata = { title: "Caja" };

export default async function CashPage() {
  const ctx = await requirePagePermission("cash.open");
  if (!ctx.company || !ctx.branch) return <Alert tone="warning">Selecciona una empresa y una sucursal.</Alert>;
  const [regs, history] = await Promise.all([listRegistersWithStatus(ctx), listSessions(ctx, { branchId: ctx.branch.id, limit: 20 })]);
  const cur = ctx.company.currency;
  const tz = ctx.company.timezone;
  const seeDiff = hasPermission(ctx, "cash.view_differences");
  return (
    <>
      <PageHeader title="Caja" description={`Turnos de ${ctx.branch.name}. Abre la caja con el fondo inicial antes de vender.`} />
      {regs.length === 0 ? (
        <EmptyState title="Esta sucursal no tiene cajas" description="Agrégalas en Sucursales." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {regs.map(({ register, session, openedByName }) => (
            <Card key={register.id} title={register.name} actions={session ? <Badge tone="success">Abierta</Badge> : <Badge>Cerrada</Badge>}>
              {session ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted">Abierta por {openedByName} el {formatDateTime(session.openedAt, tz)} con fondo de {formatCents(session.openingAmount, cur)}.</p>
                  <div className="flex flex-wrap gap-2">
                    {hasPermission(ctx, "pos.sell") && <ButtonLink href="/pos">Ir al punto de venta</ButtonLink>}
                    <ButtonLink variant="secondary" href={`/caja/${session.id}`}>Corte X / cerrar turno</ButtonLink>
                  </div>
                </div>
              ) : (
                <AppForm action={openSessionAction} successMessage={null}>
                  <input type="hidden" name="cashRegisterId" value={register.id} />
                  <FormField name="openingAmount" label="Fondo inicial en efectivo" hint="Lo que hay en el cajón al empezar.">
                    <Input name="openingAmount" inputMode="decimal" placeholder="0.00" />
                  </FormField>
                  <SubmitButton pendingText="Abriendo…">Abrir caja</SubmitButton>
                </AppForm>
              )}
            </Card>
          ))}
        </div>
      )}
      <h2 className="mb-3 mt-8 text-lg font-semibold">Turnos recientes</h2>
      {history.length === 0 ? (
        <p className="text-sm text-muted">Sin turnos todavía.</p>
      ) : (
        <Table>
          <thead><tr><th>Apertura</th><th>Caja</th><th className="hidden sm:table-cell">Cajero</th><th className="text-right">Esperado</th>{seeDiff && <th className="text-right">Diferencia</th>}<th>Estado</th></tr></thead>
          <tbody>
            {history.map(({ session: s, registerName, openedByName }) => (
              <tr key={s.id}>
                <td className="whitespace-nowrap"><Link className="link" href={`/caja/${s.id}`}>{formatDateTime(s.openedAt, tz)}</Link></td>
                <td>{registerName}</td>
                <td className="hidden sm:table-cell">{openedByName}</td>
                <td className="text-right">{s.expectedCash === null ? "—" : formatCents(s.expectedCash, cur)}</td>
                {seeDiff && <td className={`text-right ${s.difference && s.difference !== 0 ? "font-medium text-danger" : ""}`}>{s.difference === null ? "—" : formatCents(s.difference, cur)}</td>}
                <td>{s.status === "open" ? <Badge tone="success">Abierto</Badge> : <Badge>Cerrado</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
