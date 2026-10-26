import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { ConfirmAction } from "@/components/ui/form";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { NotFoundError } from "@/server/errors";
import { getCompany } from "@/server/modules/companies/service";
import { CompanyForm } from "../company-form";
import { setCompanyActiveAction, updateCompanyAction } from "../actions";

export const metadata: Metadata = { title: "Empresa" };

export default async function CompanyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ creada?: string }> }) {
  const ctx = await requirePagePermission("companies.view");
  const { id } = await params;
  const { creada } = await searchParams;
  let company;
  try {
    company = await getCompany(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const canManage = hasPermission(ctx, "companies.manage");
  return (
    <>
      <PageHeader
        title={company.tradeName}
        description={<>Código {company.code} · {company.deactivatedAt ? <Badge tone="danger">Inactiva</Badge> : <Badge tone="success">Activa</Badge>}</>}
        actions={
          canManage && (
            <ConfirmAction
              action={setCompanyActiveAction}
              label={company.deactivatedAt ? "Reactivar" : "Desactivar"}
              variant={company.deactivatedAt ? "secondary" : "danger"}
              confirmTitle={company.deactivatedAt ? "¿Reactivar la empresa?" : "¿Desactivar la empresa?"}
              confirmText={company.deactivatedAt ? "Volverá a aparecer en el selector de empresas." : "Nadie podrá operar en ella hasta reactivarla. El historial se conserva."}
              requireReason={!company.deactivatedAt}
              hiddenFields={{ id: company.id, active: company.deactivatedAt ? "true" : "false" }}
            />
          )
        }
      />
      {creada && <div className="mb-4"><Alert tone="success" title="Empresa creada">Ya puedes seleccionarla en la barra superior para configurarla.</Alert></div>}
      <Card title="Datos generales">
        {canManage ? (
          <CompanyForm action={updateCompanyAction} mode="edit" values={{ ...company, address: company.address as Record<string, string | undefined> }} />
        ) : (
          <p className="text-sm text-muted">No tienes permiso para editar esta empresa.</p>
        )}
      </Card>
    </>
  );
}
