import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ButtonLink, EmptyState, PageHeader, Table } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { listCompanies } from "@/server/modules/companies/service";

export const metadata: Metadata = { title: "Empresas" };

export default async function CompaniesPage() {
  const ctx = await requirePagePermission("companies.view");
  const companies = await listCompanies(ctx);
  const canManage = hasPermission(ctx, "companies.manage");
  return (
    <>
      <PageHeader
        title="Empresas"
        description="Cada empresa tiene su propia configuración, sucursales, catálogo e inventario."
        actions={canManage && <ButtonLink href="/empresas/nueva">Nueva empresa</ButtonLink>}
      />
      {companies.length === 0 ? (
        <EmptyState title="Sin empresas" action={canManage && <ButtonLink href="/empresas/nueva">Crear la primera</ButtonLink>} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre comercial</th>
              <th className="hidden md:table-cell">Razón social</th>
              <th className="hidden sm:table-cell">Moneda</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id}>
                <td className="font-mono text-xs">{c.code}</td>
                <td>
                  <Link className="link font-medium" href={`/empresas/${c.id}`}>{c.tradeName}</Link>
                  {ctx.company?.id === c.id && <span className="ml-2 text-xs text-muted">(activa)</span>}
                </td>
                <td className="hidden md:table-cell">{c.legalName}</td>
                <td className="hidden sm:table-cell">{c.currency}</td>
                <td>{c.deactivatedAt ? <Badge tone="danger">Inactiva</Badge> : <Badge tone="success">Activa</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
