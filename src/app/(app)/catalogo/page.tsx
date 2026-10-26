import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, ButtonLink, Card, EmptyState, PageHeader, Table } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { listCatalogOptions, listProducts } from "@/server/modules/catalog/service";
import { formatCents, formatQty } from "@/lib/money";

export const metadata: Metadata = { title: "Catálogo" };
const PAGE = 50;

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ q?: string; cat?: string; p?: string; inactivos?: string }> }) {
  const ctx = await requirePagePermission("catalog.view");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const q = await searchParams;
  const page = Math.max(1, Number(q.p ?? 1));
  const [{ items, hasMore }, opts] = await Promise.all([
    listProducts(ctx, { q: q.q, categoryId: q.cat || null, includeInactive: q.inactivos === "1", limit: PAGE, offset: (page - 1) * PAGE }),
    listCatalogOptions(ctx),
  ]);
  const canCreate = hasPermission(ctx, "catalog.create");
  const showCost = hasPermission(ctx, "catalog.view_cost");
  const cur = ctx.company.currency;
  const qs = (o: Record<string, string>) => `/catalogo?${new URLSearchParams({ ...(Object.fromEntries(Object.entries(q).filter(([, v]) => v)) as Record<string, string>), ...o })}`;
  return (
    <>
      <PageHeader
        title="Catálogo"
        description="Productos, variantes, precios y códigos de barras."
        actions={canCreate && <ButtonLink href="/catalogo/nuevo">Nuevo producto</ButtonLink>}
      />
      <Card className="mb-4">
        <form method="get" className="grid gap-3 sm:grid-cols-[1fr_200px_auto_auto]">
          <input name="q" defaultValue={q.q} placeholder="Buscar por nombre, SKU o código de barras" className="field" aria-label="Buscar" autoFocus />
          <select name="cat" defaultValue={q.cat ?? ""} className="field" aria-label="Categoría">
            <option value="">Todas las categorías</option>
            {opts.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="inactivos" value="1" defaultChecked={q.inactivos === "1"} className="accent-primary" /> Incluir inactivos</label>
          <button className="min-h-11 rounded-app bg-primary px-4 text-sm font-medium text-primary-fg">Buscar</button>
        </form>
      </Card>
      {items.length === 0 ? (
        <EmptyState
          title={q.q ? "Sin resultados" : "Aún no hay productos"}
          description={q.q ? "Prueba con otro término o código." : "Da de alta tu primer producto para empezar a vender."}
          action={canCreate && !q.q && <ButtonLink href="/catalogo/nuevo">Nuevo producto</ButtonLink>}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Producto</th>
              <th className="hidden md:table-cell">Categoría</th>
              <th className="text-right">Precio</th>
              <th className="hidden text-right sm:table-cell">Existencia</th>
              <th className="hidden lg:table-cell">Estado</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link className="link font-medium" href={`/catalogo/${p.id}`}>{p.name}</Link>
                  {p.isFavorite && <span className="ml-1" title="Favorito en el POS">★</span>}
                  <span className="block font-mono text-xs text-muted">
                    {p.sku}
                    {p.kind === "variable" && ` · ${p.variantCount} variantes`}
                  </span>
                </td>
                <td className="hidden text-muted md:table-cell">{p.categoryName ?? "—"}{p.brandName && <span className="block text-xs">{p.brandName}</span>}</td>
                <td className="text-right whitespace-nowrap">
                  {p.minPrice === p.maxPrice ? formatCents(p.minPrice, cur) : `${formatCents(p.minPrice, cur)} – ${formatCents(p.maxPrice, cur)}`}
                </td>
                <td className="hidden text-right sm:table-cell">
                  {p.stock === null ? <span className="text-muted">{p.trackStock ? "0" : "No controla"}</span> : <span className={p.stock <= 0 ? "font-medium text-danger" : ""}>{formatQty(p.stock)}</span>}
                </td>
                <td className="hidden lg:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {!p.active && <Badge tone="danger">Inactivo</Badge>}
                    {showCost && p.missingCost && <Badge tone="warning">Sin costo</Badge>}
                    {p.active && !(showCost && p.missingCost) && <Badge tone="success">Activo</Badge>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <div className="mt-4 flex justify-between">
        {page > 1 ? <ButtonLink variant="secondary" href={qs({ p: String(page - 1) })}>← Anteriores</ButtonLink> : <span />}
        {hasMore && <ButtonLink variant="secondary" href={qs({ p: String(page + 1) })}>Siguientes →</ButtonLink>}
      </div>
      {showCost && <p className="mt-3 text-xs text-muted">«Sin costo»: la utilidad de estos productos se reportará como incompleta hasta capturar su costo.</p>}
    </>
  );
}
