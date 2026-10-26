import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { AppForm, Checkbox, ConfirmAction, FormField, Input, Select, SubmitButton } from "@/components/ui/form";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { NotFoundError } from "@/server/errors";
import { getProduct, listCatalogOptions } from "@/server/modules/catalog/service";
import { setProductActiveAction, updateProductAction } from "../actions";
import { VariantEditor } from "./variant-editor";

export const metadata: Metadata = { title: "Producto" };

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ creado?: string }> }) {
  const ctx = await requirePagePermission("catalog.view");
  const { id } = await params;
  const { creado } = await searchParams;
  let detail;
  try {
    detail = await getProduct(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { product } = detail;
  const canEdit = hasPermission(ctx, "catalog.edit");
  const opts = canEdit ? await listCatalogOptions(ctx) : null;
  const active = !product.deactivatedAt;
  return (
    <>
      <PageHeader
        title={product.name}
        description={
          <>
            <span className="font-mono">{product.sku}</span> · {product.kind === "variable" ? `Con variantes (${product.attributeNames.join(", ")})` : "Producto simple"} ·{" "}
            {active ? <Badge tone="success">Activo</Badge> : <Badge tone="danger">Inactivo</Badge>}
          </>
        }
        actions={
          hasPermission(ctx, "catalog.disable") && (
            <ConfirmAction
              action={setProductActiveAction}
              label={active ? "Desactivar" : "Activar"}
              variant={active ? "danger" : "secondary"}
              confirmTitle={active ? "¿Desactivar el producto?" : "¿Activar el producto?"}
              confirmText={active ? "Dejará de aparecer en el punto de venta. Su historial y existencias se conservan." : "Volverá a estar disponible para vender."}
              requireReason={active}
              hiddenFields={{ id: product.id, active: active ? "false" : "true" }}
            />
          )
        }
      />
      {creado && <div className="mb-4"><Alert tone="success" title="Producto creado">Ya está disponible en el punto de venta.</Alert></div>}
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card title="Datos generales">
          {canEdit && opts ? (
            <AppForm action={updateProductAction} successMessage="Producto actualizado.">
              <input type="hidden" name="id" value={product.id} />
              <FormField name="name" label="Nombre" required><Input name="name" defaultValue={product.name} /></FormField>
              <FormField name="categoryName" label="Categoría">
                <Input name="categoryName" defaultValue={detail.categoryName ?? ""} list="cat-list" />
              </FormField>
              <datalist id="cat-list">{opts.categories.map((c) => <option key={c.id} value={c.name} />)}</datalist>
              <FormField name="brandName" label="Marca">
                <Input name="brandName" defaultValue={detail.brandName ?? ""} list="brand-list" />
              </FormField>
              <datalist id="brand-list">{opts.brands.map((b) => <option key={b.id} value={b.name} />)}</datalist>
              <FormField name="unitId" label="Unidad" required>
                <Select name="unitId" defaultValue={product.unitId}>{opts.units.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}</Select>
              </FormField>
              <FormField name="taxProfileId" label="Impuesto" required>
                <Select name="taxProfileId" defaultValue={product.taxProfileId}>{opts.taxes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
              </FormField>
              <FormField name="description" label="Descripción"><Input name="description" defaultValue={product.description ?? ""} /></FormField>
              <FormField name="satProductCode" label="Clave SAT de producto"><Input name="satProductCode" defaultValue={product.satProductCode ?? ""} /></FormField>
              <div className="grid gap-2">
                <Checkbox name="trackStock" label="Controlar inventario" defaultChecked={product.trackStock} />
                <Checkbox name="isFavorite" label="Favorito en el punto de venta" defaultChecked={product.isFavorite} />
              </div>
              <SubmitButton>Guardar</SubmitButton>
            </AppForm>
          ) : (
            <dl className="grid gap-3 text-sm">
              <div><dt className="text-muted">Categoría</dt><dd>{detail.categoryName ?? "—"}</dd></div>
              <div><dt className="text-muted">Marca</dt><dd>{detail.brandName ?? "—"}</dd></div>
              <div><dt className="text-muted">Unidad</dt><dd>{detail.unit.name}</dd></div>
              <div><dt className="text-muted">Impuesto</dt><dd>{detail.tax.name}</dd></div>
            </dl>
          )}
        </Card>
        <Card title={product.kind === "variable" ? `Variantes (${detail.variants.length})` : "Precio, costo y códigos"}>
          <VariantEditor
            productId={product.id}
            kind={product.kind}
            attributeNames={product.attributeNames}
            currency={ctx.company?.currency ?? "MXN"}
            canEdit={canEdit}
            canPrice={hasPermission(ctx, "catalog.edit_price")}
            canCost={hasPermission(ctx, "catalog.view_cost")}
            canDisable={hasPermission(ctx, "catalog.disable")}
            canStock={hasPermission(ctx, "inventory.adjust")}
            trackStock={product.trackStock}
            variants={detail.variants.map((v) => ({
              id: v.id,
              sku: v.sku,
              variantName: v.variantName,
              attributeValues: v.attributeValues,
              price: v.price,
              cost: v.cost,
              barcodes: v.barcodes,
              minStock: v.minStock,
              reorderPoint: v.reorderPoint,
              active: !v.deactivatedAt,
              stock: v.stock.map((s) => ({ code: s.code, onHand: s.onHand })),
            }))}
          />
        </Card>
      </div>
    </>
  );
}
