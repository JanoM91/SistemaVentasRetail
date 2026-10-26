import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, Card, Description, PageHeader, Table } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { listCompanyModules } from "@/server/modules/companies/service";
import { listDocumentSequences, listPaymentMethods, listSalesChannels, listTaxProfiles } from "@/server/modules/settings/queries";
import { ModulesForm, SettingsForm } from "./forms";

export const metadata: Metadata = { title: "Configuración" };

export default async function SettingsPage() {
  const ctx = await requirePagePermission("settings.view");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa para configurarla.</Alert>;
  const company = ctx.company;
  const canManage = hasPermission(ctx, "settings.manage");
  const [modules, taxes, payments, channels, sequences] = await Promise.all([
    listCompanyModules(ctx, company.id),
    listTaxProfiles(ctx),
    listPaymentMethods(ctx),
    listSalesChannels(ctx),
    listDocumentSequences(ctx),
  ]);
  return (
    <>
      <PageHeader title="Configuración" description={`Empresa activa: ${company.tradeName}. Cambia de empresa en la barra superior para configurar otra.`} />
      <div className="space-y-6">
        <Card title="Datos y configuración regional" actions={hasPermission(ctx, "companies.view") && <Link className="link text-sm" href={`/empresas/${company.id}`}>Editar</Link>}>
          <Description
            items={[
              { label: "Razón social", value: company.legalName },
              { label: "RFC", value: company.taxId },
              { label: "Moneda", value: company.currency },
              { label: "Zona horaria", value: company.timezone },
              { label: "Idioma y región", value: company.locale },
              { label: "Formato de fecha", value: company.dateFormat },
            ]}
          />
        </Card>

        <Card title="Módulos activos">
          <p className="mb-3 text-sm text-muted">Cada negocio ve solo lo que necesita. Al apagar un módulo, sus permisos dejan de aplicar para todos los usuarios de esta empresa.</p>
          <ModulesForm companyId={company.id} modules={modules} canManage={canManage} />
        </Card>

        <Card title="Parámetros de operación">
          <SettingsForm companyId={company.id} settings={company.settings} canManage={canManage} />
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Impuestos">
            <Table>
              <thead><tr><th>Código</th><th>Nombre</th><th>Tasa</th><th>Incluido</th></tr></thead>
              <tbody>
                {taxes.map((t) => (
                  <tr key={t.id}>
                    <td className="font-mono text-xs">{t.code}</td>
                    <td>{t.name} {t.isDefault && <Badge tone="info">Por defecto</Badge>}</td>
                    <td>{(Number(t.rate) * 100).toFixed(2)} %</td>
                    <td>{t.isIncludedInPrice ? "En precio" : "Más impuesto"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="mt-2 text-xs text-muted">Se configuran por defecto para México. La edición de impuestos llega con el catálogo (Fase 3).</p>
          </Card>

          <Card title="Métodos de pago">
            <Table>
              <thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th><th>Estado</th></tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="font-mono text-xs">{p.code}</td>
                    <td>{p.name}</td>
                    <td className="text-muted">{p.kind}{p.provider !== "manual" && ` · ${p.provider}`}</td>
                    <td>{p.isActive ? <Badge tone="success">Activo</Badge> : <Badge>Inactivo</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="mt-2 text-xs text-muted">Los adaptadores de terminal, QR y billeteras se activan en la Fase 4.</p>
          </Card>

          <Card title="Canales de venta">
            <Table>
              <thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th></tr></thead>
              <tbody>
                {channels.map((c) => (
                  <tr key={c.id}><td className="font-mono text-xs">{c.code}</td><td>{c.name}</td><td className="text-muted">{c.kind}</td></tr>
                ))}
              </tbody>
            </Table>
            <p className="mt-2 text-xs text-muted">Ecommerce, WhatsApp y marketplaces se integran en la Fase 5.</p>
          </Card>

          <Card title="Series y folios">
            <Table>
              <thead><tr><th>Sucursal</th><th>Documento</th><th>Serie</th><th>Siguiente</th></tr></thead>
              <tbody>
                {sequences.map(({ seq, branchName }) => (
                  <tr key={seq.id}>
                    <td>{branchName ?? "Empresa"}</td>
                    <td>{{ sale: "Venta", quote: "Cotización", return: "Devolución", purchase: "Compra", transfer: "Traspaso", invoice: "Factura" }[seq.documentType]}</td>
                    <td className="font-mono text-xs">{seq.series}</td>
                    <td className="font-mono text-xs">{String(seq.nextNumber).padStart(seq.padding, "0")}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      </div>
    </>
  );
}
