import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, ButtonLink, EmptyState, PageHeader, Table } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { listBranches, listCashRegisters, listWarehouses } from "@/server/modules/branches/service";

export const metadata: Metadata = { title: "Sucursales" };

export default async function BranchesPage() {
  const ctx = await requirePagePermission("branches.view");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa para ver sus sucursales.</Alert>;
  const canManage = hasPermission(ctx, "branches.manage");
  const [branches, warehouses, registers] = await Promise.all([listBranches(ctx, { includeInactive: canManage }), listWarehouses(ctx), listCashRegisters(ctx)]);
  const count = (list: Array<{ branchId: string }>, id: string) => list.filter((x) => x.branchId === id).length;
  return (
    <>
      <PageHeader
        title="Sucursales"
        description={`Sucursales, almacenes y cajas de ${ctx.company.tradeName}.`}
        actions={canManage && <ButtonLink href="/sucursales/nueva">Nueva sucursal</ButtonLink>}
      />
      {branches.length === 0 ? (
        <EmptyState title="Sin sucursales visibles" />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th className="hidden sm:table-cell">Almacenes</th>
              <th className="hidden sm:table-cell">Cajas</th>
              <th className="hidden md:table-cell">Teléfono</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {branches.map((b) => (
              <tr key={b.id}>
                <td className="font-mono text-xs">{b.code}</td>
                <td>
                  <Link className="link font-medium" href={`/sucursales/${b.id}`}>{b.name}</Link>
                  {ctx.branch?.id === b.id && <span className="ml-2 text-xs text-muted">(activa)</span>}
                </td>
                <td className="hidden sm:table-cell">{count(warehouses, b.id)}</td>
                <td className="hidden sm:table-cell">{count(registers, b.id)}</td>
                <td className="hidden md:table-cell">{b.phone ?? "—"}</td>
                <td>{b.deactivatedAt ? <Badge tone="danger">Inactiva</Badge> : <Badge tone="success">Activa</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
