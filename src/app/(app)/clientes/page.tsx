import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, ButtonLink, Card, EmptyState, PageHeader, Table } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { listCustomers, listGroups, SEGMENTS } from "@/server/modules/customers/service";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { ClientesTabs } from "./tabs";

export const metadata: Metadata = { title: "Clientes" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; segmento?: string; grupo?: string; inactivos?: string }> }) {
  const ctx = await requirePagePermission("customers.view");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const q = await searchParams;
  const showCredit = hasPermission(ctx, "credit.view");
  const segments = (Object.keys(SEGMENTS) as Array<keyof typeof SEGMENTS>).filter((k) => showCredit || (k !== "con_saldo" && k !== "vencidos"));
  const [rows, groups] = await Promise.all([listCustomers(ctx, { q: q.q, segment: q.segmento, groupId: q.grupo, includeInactive: q.inactivos === "1" }), listGroups(ctx)]);
  const cur = ctx.company.currency;
  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ q: q.q, segmento: q.segmento, grupo: q.grupo, ...patch }).filter(([, v]) => v) as Array<[string, string]>);
    return `/clientes${p.size ? `?${p}` : ""}`;
  };
  return (
    <>
      <PageHeader
        title="Clientes"
        description="Historial de compras, segmentos y crédito."
        actions={
          <>
            {hasPermission(ctx, "customers.export") && (
              // Descarga de archivo (no es una página): enlace nativo.
              <a download className="inline-flex min-h-11 items-center rounded-app border border-border px-4 text-sm font-medium hover:bg-surface-2" href="/api/v1/customers/export">Exportar CSV</a>
            )}
            {hasPermission(ctx, "customers.manage") && <ButtonLink href="/clientes/nuevo">Nuevo cliente</ButtonLink>}
          </>
        }
      />
      <ClientesTabs ctx={ctx} active="/clientes" />
      <Card className="mb-4">
        <form method="get" className="grid gap-3 sm:grid-cols-[1fr_200px_auto]">
          {q.segmento && <input type="hidden" name="segmento" value={q.segmento} />}
          <input name="q" defaultValue={q.q} placeholder="Nombre, teléfono, correo, RFC o clave" className="field" aria-label="Buscar cliente" />
          <select name="grupo" defaultValue={q.grupo ?? ""} className="field" aria-label="Grupo">
            <option value="">Todos los grupos</option>
            {groups.map((g) => <option key={g.g.id} value={g.g.id}>{g.g.name}</option>)}
          </select>
          <button className="min-h-11 rounded-app bg-primary px-4 text-sm font-medium text-primary-fg">Buscar</button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={link({ segmento: undefined })} className={`rounded-full border px-3 py-1 text-sm ${!q.segmento ? "border-primary bg-primary/10 text-primary" : "border-border text-muted"}`}>Todos</Link>
          {segments.map((k) => (
            <Link key={k} href={link({ segmento: k })} title={SEGMENTS[k].hint} className={`rounded-full border px-3 py-1 text-sm ${q.segmento === k ? "border-primary bg-primary/10 text-primary" : "border-border text-muted hover:text-text"}`}>{SEGMENTS[k].label}</Link>
          ))}
        </div>
      </Card>
      {rows.length === 0 ? (
        <EmptyState title="Sin clientes con ese filtro" description="Los clientes se registran aquí o desde el punto de venta al cobrar." action={hasPermission(ctx, "customers.manage") ? <ButtonLink href="/clientes/nuevo">Nuevo cliente</ButtonLink> : undefined} />
      ) : (
        <>
          <p className="mb-2 text-sm text-muted">{rows.length} cliente(s){q.segmento && SEGMENTS[q.segmento as keyof typeof SEGMENTS] ? ` · ${SEGMENTS[q.segmento as keyof typeof SEGMENTS].hint}` : ""}</p>
          <Table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th className="hidden md:table-cell">Contacto</th>
                <th className="hidden lg:table-cell">Grupo</th>
                <th className="text-right">Compras</th>
                <th className="hidden sm:table-cell text-right">Total</th>
                <th className="hidden md:table-cell">Última</th>
                {showCredit && <th className="text-right">Saldo</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, groupName, recent90 }) => (
                <tr key={c.id}>
                  <td>
                    <Link className="link font-medium" href={`/clientes/${c.id}`}>{c.name}</Link> {c.deactivatedAt && <Badge>Inactivo</Badge>}
                    <span className="block font-mono text-xs text-muted">{c.code}{c.taxId && ` · ${c.taxId}`}</span>
                  </td>
                  <td className="hidden md:table-cell text-muted">{[c.phone, c.email].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="hidden lg:table-cell text-muted">{groupName ?? "—"}</td>
                  <td className="text-right">{c.purchasesCount}{recent90 > 0 && <span className="block text-xs text-muted">{recent90} en 90 d</span>}</td>
                  <td className="hidden sm:table-cell text-right">{formatCents(c.purchasesTotal, cur)}</td>
                  <td className="hidden md:table-cell text-muted">{c.lastPurchaseAt ? formatDate(c.lastPurchaseAt) : "—"}</td>
                  {showCredit && <td className="text-right font-medium">{c.creditBalance ? formatCents(c.creditBalance, cur) : <span className="text-muted">—</span>}</td>}
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </>
  );
}
