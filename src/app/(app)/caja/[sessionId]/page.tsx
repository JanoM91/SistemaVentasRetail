import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card, PageHeader, Stat, Table } from "@/components/ui";
import { AppForm, FormField, Input, Select, SubmitButton } from "@/components/ui/form";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { NotFoundError } from "@/server/errors";
import { getSessionDetail } from "@/server/modules/cash/service";
import { formatCents } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { cashMovementAction } from "../actions";
import { CloseForm } from "./close-form";
import { PrintButton } from "@/components/print-button";

export const metadata: Metadata = { title: "Turno de caja" };

export default async function SessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const ctx = await requirePagePermission("cash.open");
  const { sessionId } = await params;
  let d;
  try {
    d = await getSessionDetail(ctx, sessionId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { session: s, register, summary } = d;
  const cur = ctx.company?.currency ?? "MXN";
  const tz = ctx.company?.timezone;
  const open = s.status === "open";
  const canClose = hasPermission(ctx, "cash.close") && (s.openedBy === ctx.userId || hasPermission(ctx, "cash.close_any"));
  const showExpected = d.canSeeDifferences;
  return (
    <div className="print:text-black">
      <PageHeader
        title={`${register.name} · ${open ? "Corte X (turno abierto)" : "Corte Z"}`}
        description={
          <>
            Abierto por {d.openedByName} el {formatDateTime(s.openedAt, tz)}
            {s.closedAt && <> · cerrado por {d.closedByName} el {formatDateTime(s.closedAt, tz)}</>} · {open ? <Badge tone="success">Abierto</Badge> : <Badge>Cerrado</Badge>}
          </>
        }
        actions={<PrintButton label={open ? "Imprimir corte X" : "Imprimir corte Z"} />}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Ventas" value={summary.salesCount} hint={formatCents(summary.salesTotal, cur)} />
        <Stat label="Canceladas" value={summary.cancelledCount} hint={formatCents(summary.cancelledTotal, cur)} />
        <Stat label="Retiros" value={formatCents(summary.withdrawals, cur)} />
        <Stat label="Depósitos" value={formatCents(summary.deposits, cur)} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Ventas por método de pago" actions={<Link className="link text-sm print:hidden" href={`/ventas?turno=${s.id}`}>Ver ventas</Link>}>
          <Table className="border-0">
            <tbody>
              {summary.byMethod.length === 0 && <tr><td className="text-muted">Sin ventas.</td></tr>}
              {summary.byMethod.map((m) => (
                <tr key={m.methodId}><td>{m.name}</td><td className="text-right text-muted">{m.count}</td><td className="text-right font-medium">{formatCents(m.amount, cur)}</td></tr>
              ))}
                          {(summary.creditPayments ?? []).length > 0 && (
                <>
                  <tr><td colSpan={3} className="pt-4 text-xs font-medium uppercase tracking-wide text-muted">Abonos de clientes</td></tr>
                  {summary.creditPayments!.map((m) => (
                    <tr key={`ab-${m.methodId}`}><td>{m.name}</td><td className="text-right text-muted">{m.count}</td><td className="text-right font-medium">{formatCents(m.amount, cur)}</td></tr>
                  ))}
                </>
              )}
            </tbody>
          </Table>
        </Card>
        <Card title="Efectivo en caja">
          <Table className="border-0">
            <tbody>
              <tr><td>Fondo inicial</td><td className="text-right">{formatCents(s.openingAmount, cur)}</td></tr>
              <tr><td>+ Ventas en efectivo</td><td className="text-right">{formatCents(summary.cashSales, cur)}</td></tr>
              {!!summary.cashCreditPayments && <tr><td>+ Abonos en efectivo</td><td className="text-right">{formatCents(summary.cashCreditPayments, cur)}</td></tr>}
              <tr><td>+ Depósitos</td><td className="text-right">{formatCents(summary.deposits, cur)}</td></tr>
              <tr><td>− Retiros</td><td className="text-right">{formatCents(summary.withdrawals, cur)}</td></tr>
              {(showExpected || !open) && <tr><td className="font-semibold">Efectivo esperado</td><td className="text-right font-semibold">{formatCents(summary.expectedCash, cur)}</td></tr>}
              {!open && (
                <>
                  <tr><td>Efectivo contado</td><td className="text-right">{formatCents(s.countedCash, cur)}</td></tr>
                  {showExpected && (
                    <tr>
                      <td className="font-semibold">Diferencia</td>
                      <td className={`text-right font-semibold ${s.difference === 0 ? "text-success" : "text-danger"}`}>{formatCents(s.difference, cur)} {s.difference === 0 ? "(cuadra)" : (s.difference ?? 0) > 0 ? "(sobrante)" : "(faltante)"}</td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </Table>
          {s.notes && <p className="mt-2 whitespace-pre-line text-sm text-muted">Notas: {s.notes}</p>}
        </Card>
      </div>

      <Card title="Retiros y depósitos" className="mt-6">
        {d.movements.length > 0 && (
          <Table className="mb-4">
            <thead><tr><th>Hora</th><th>Tipo</th><th>Motivo</th><th className="text-right">Importe</th></tr></thead>
            <tbody>
              {d.movements.map(({ m, userName }) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap text-muted">{formatDateTime(m.createdAt, tz)}</td>
                  <td>{m.kind === "withdrawal" ? "Retiro" : "Depósito"}{m.authorizedBy && <Badge tone="info">autorizado</Badge>}</td>
                  <td>{m.reason}<span className="block text-xs text-muted">{userName}</span></td>
                  <td className="text-right font-medium">{formatCents(m.amount, cur)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {open ? (
          <div className="print:hidden">
            <AppForm action={cashMovementAction} successMessage="Movimiento registrado.">
              <input type="hidden" name="cashSessionId" value={s.id} />
              <div className="grid gap-3 sm:grid-cols-4">
                <FormField name="kind" label="Tipo"><Select name="kind"><option value="withdrawal">Retiro</option><option value="deposit">Depósito</option></Select></FormField>
                <FormField name="amount" label="Importe" required><Input name="amount" inputMode="decimal" placeholder="0.00" /></FormField>
                <div className="sm:col-span-2"><FormField name="reason" label="Motivo" required><Input name="reason" placeholder="p. ej. Depósito bancario, cambio de morralla" /></FormField></div>
              </div>
              {!(hasPermission(ctx, "cash.withdraw") && hasPermission(ctx, "cash.deposit")) && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted">Autorización de gerente (si tu rol no lo permite)</summary>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <FormField name="authorizerUsername" label="Usuario del gerente"><Input name="authorizerUsername" autoComplete="off" /></FormField>
                    <FormField name="authorizerPassword" label="Contraseña"><Input name="authorizerPassword" type="password" autoComplete="off" /></FormField>
                  </div>
                </details>
              )}
              <SubmitButton variant="secondary">Registrar</SubmitButton>
            </AppForm>
          </div>
        ) : (
          d.movements.length === 0 && <p className="text-sm text-muted">Sin movimientos.</p>
        )}
      </Card>

      {open && (
        <Card title="Cerrar turno (corte Z)" className="mt-6 print:hidden">
          {canClose ? (
            <CloseForm sessionId={s.id} expected={summary.expectedCash} showExpected={showExpected} currency={cur} />
          ) : (
            <Alert tone="info">Solo quien abrió el turno o un gerente puede cerrarlo.</Alert>
          )}
        </Card>
      )}
      {!open && s.denominations && (
        <Card title="Conteo por denominación" className="mt-6">
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {Object.entries(s.denominations).sort((a, b) => Number(b[0]) - Number(a[0])).map(([v, n]) => (
              <div key={v} className="flex justify-between rounded border border-border px-2 py-1"><span>{formatCents(Number(v), cur)} × {n}</span><span className="font-medium">{formatCents(Number(v) * n, cur)}</span></div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
