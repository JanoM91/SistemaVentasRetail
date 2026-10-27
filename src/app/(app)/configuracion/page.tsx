import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card, Description, PageHeader, Table } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { listCompanyModules } from "@/server/modules/companies/service";
import { listDocumentSequences, listPaymentMethods, listSalesChannels, listTaxProfiles } from "@/server/modules/settings/queries";
import { ModulesForm, SettingsForm } from "./forms";
import { PaymentMethodsEditor, TaxesEditor } from "./catalog-editors";
import { EDITABLE_PAYMENT_KINDS, PAYMENT_KIND_LABELS } from "@/server/modules/settings/service";
import { db } from "@/server/db";
import { products } from "@/server/db/schema";
import { eq, sql } from "drizzle-orm";

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
  const taxUse = await db.select({ taxProfileId: products.taxProfileId, n: sql<number>`count(*)`.mapWith(Number) }).from(products).where(eq(products.companyId, company.id)).groupBy(products.taxProfileId);
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
            <TaxesEditor
              canManage={canManage}
              taxes={taxes.map((t) => ({ id: t.id, code: t.code, name: t.name, kind: t.kind, ratePercent: String(Math.round(Number(t.rate) * 1_000_000) / 10_000), isIncludedInPrice: t.isIncludedInPrice, isDefault: t.isDefault, products: taxUse.find((u) => u.taxProfileId === t.id)?.n ?? 0 }))}
            />
          </Card>

          <Card title="Métodos de pago">
            <PaymentMethodsEditor
              canManage={canManage}
              kinds={EDITABLE_PAYMENT_KINDS.map((k) => ({ value: k, label: PAYMENT_KIND_LABELS[k] }))}
              methods={payments.map((p) => ({ id: p.id, code: p.code, name: p.name, kind: p.kind, kindLabel: PAYMENT_KIND_LABELS[p.kind] ?? p.kind, requiresReference: p.requiresReference, isActive: p.isActive, sortOrder: p.sortOrder, system: p.kind === "customer_credit" || p.kind === "prepaid" }))}
            />
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
                    <td>{{ sale: "Venta", quote: "Cotización", return: "Devolución", purchase: "Orden de compra", receipt: "Recepción de compra", supplier_return: "Devolución a proveedor", transfer: "Traspaso", count: "Conteo físico", invoice: "Factura", customer_payment: "Abono de cliente", customer: "Clave de cliente" }[seq.documentType]}</td>
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
