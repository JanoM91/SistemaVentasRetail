import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader, Table } from "@/components/ui";
import { ConfirmAction } from "@/components/ui/form";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { NotFoundError } from "@/server/errors";
import { getBranch, listCashRegisters, listWarehouses } from "@/server/modules/branches/service";
import { BranchForm } from "../branch-form";
import { deactivateCashRegisterAction, setBranchActiveAction, updateBranchAction } from "../actions";
import { NewCashRegisterForm, NewWarehouseForm, WarehouseRowForm } from "./sub-forms";

export const metadata: Metadata = { title: "Sucursal" };

export default async function BranchPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("branches.view");
  const { id } = await params;
  let branch;
  try {
    branch = await getBranch(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const canManage = hasPermission(ctx, "branches.manage");
  const [warehouses, registers] = await Promise.all([listWarehouses(ctx, id), listCashRegisters(ctx, id)]);
  return (
    <>
      <PageHeader
        title={branch.name}
        description={<>Código {branch.code} · {branch.deactivatedAt ? <Badge tone="danger">Inactiva</Badge> : <Badge tone="success">Activa</Badge>}</>}
        actions={
          canManage && (
            <ConfirmAction
              action={setBranchActiveAction}
              label={branch.deactivatedAt ? "Reactivar" : "Desactivar"}
              variant={branch.deactivatedAt ? "secondary" : "danger"}
              confirmTitle={branch.deactivatedAt ? "¿Reactivar la sucursal?" : "¿Desactivar la sucursal?"}
              confirmText="Las ventas e inventario históricos se conservan."
              requireReason={!branch.deactivatedAt}
              hiddenFields={{ id: branch.id, active: branch.deactivatedAt ? "true" : "false" }}
            />
          )
        }
      />
      <div className="space-y-6">
        <Card title="Datos de la sucursal">
          {canManage ? (
            <BranchForm action={updateBranchAction} mode="edit" values={{ ...branch, address: branch.address as Record<string, string | undefined> }} />
          ) : (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">Teléfono</dt><dd>{branch.phone ?? "—"}</dd></div>
              <div><dt className="text-muted">Correo</dt><dd>{branch.email ?? "—"}</dd></div>
              <div><dt className="text-muted">Zona horaria</dt><dd>{branch.timezone ?? `${ctx.company?.timezone} (empresa)`}</dd></div>
            </dl>
          )}
        </Card>

        <Card title="Almacenes">
          <Table className="mb-4">
            <thead><tr><th>Código</th><th>Nombre</th><th>Principal</th><th>Inventario negativo</th>{canManage && <th></th>}</tr></thead>
            <tbody>
              {warehouses.map((w) => (
                <tr key={w.id}>
                  <td className="font-mono text-xs">{w.code}</td>
                  {canManage ? (
                    <WarehouseRowForm warehouse={{ id: w.id, branchId: w.branchId, name: w.name, isDefault: w.isDefault, allowsNegativeStock: w.allowsNegativeStock }} />
                  ) : (
                    <>
                      <td>{w.name}</td>
                      <td>{w.isDefault ? <Badge tone="info">Principal</Badge> : "—"}</td>
                      <td>{w.allowsNegativeStock ? "Permitido" : "No"}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
          {canManage && <NewWarehouseForm branchId={branch.id} />}
        </Card>

        <Card title="Cajas y terminales">
          <Table className="mb-4">
            <thead><tr><th>Código</th><th>Nombre</th><th>Dispositivo</th>{canManage && <th></th>}</tr></thead>
            <tbody>
              {registers.length === 0 && <tr><td colSpan={4} className="text-muted">Sin cajas activas.</td></tr>}
              {registers.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-xs">{r.code}</td>
                  <td>{r.name}</td>
                  <td className="text-muted">{r.deviceId ?? "Sin asignar"}</td>
                  {canManage && (
                    <td className="text-right">
                      <ConfirmAction
                        action={deactivateCashRegisterAction}
                        label="Desactivar"
                        variant="ghost"
                        confirmTitle={`¿Desactivar ${r.name}?`}
                        requireReason
                        hiddenFields={{ id: r.id, branchId: branch.id }}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
          {canManage && <NewCashRegisterForm branchId={branch.id} />}
        </Card>
      </div>
    </>
  );
}
