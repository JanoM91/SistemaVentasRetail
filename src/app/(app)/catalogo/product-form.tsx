"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Wand2 } from "lucide-react";
import { Alert, Button, ButtonLink, Card } from "@/components/ui";
import { createProductAction } from "./actions";

type Option = { id: string; name: string };
type Unit = { id: string; code: string; name: string; allowsDecimals: boolean };
type Tax = { id: string; code: string; name: string; isDefault: boolean };

type VariantRow = {
  key: string;
  attributeValues: Record<string, string>;
  sku: string;
  price: string;
  cost: string;
  barcodes: string;
  initialStock: string;
};

type Attr = { name: string; values: string };

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 6);

function cartesian(attrs: Array<{ name: string; values: string[] }>): Array<Record<string, string>> {
  return attrs.reduce<Array<Record<string, string>>>(
    (acc, a) => acc.flatMap((combo) => a.values.map((v) => ({ ...combo, [a.name]: v }))),
    [{}],
  );
}

const splitCodes = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

export function ProductCreateForm({
  categories,
  brands,
  units,
  taxes,
  canCost,
  canStock,
  branchName,
}: {
  categories: Option[];
  brands: Option[];
  units: Unit[];
  taxes: Tax[];
  canCost: boolean;
  canStock: boolean;
  branchName: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<{ message: string; fields?: Record<string, string[]> } | null>(null);

  const [kind, setKind] = useState<"simple" | "variable">("simple");
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [description, setDescription] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [brandName, setBrandName] = useState("");
  const [unitId, setUnitId] = useState(units.find((u) => u.code === "PZA")?.id ?? units[0]?.id ?? "");
  const [taxProfileId, setTaxProfileId] = useState(taxes.find((t) => t.isDefault)?.id ?? taxes[0]?.id ?? "");
  const [trackStock, setTrackStock] = useState(true);
  const [isFavorite, setIsFavorite] = useState(false);
  const [satProductCode, setSatProductCode] = useState("");

  // Producto simple
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [codes, setCodes] = useState("");
  const [initialStock, setInitialStock] = useState("");
  const [minStock, setMinStock] = useState("");
  const [reorderPoint, setReorderPoint] = useState("");

  // Producto con variantes
  const [attrs, setAttrs] = useState<Attr[]>([{ name: "Talla", values: "CH, M, G" }, { name: "Color", values: "" }]);
  const [rows, setRows] = useState<VariantRow[]>([]);

  const unit = units.find((u) => u.id === unitId);
  const attrNames = useMemo(() => attrs.map((a) => a.name.trim()).filter(Boolean), [attrs]);

  function generate() {
    const defined = attrs
      .map((a) => ({ name: a.name.trim(), values: [...new Set(a.values.split(",").map((v) => v.trim()).filter(Boolean))] }))
      .filter((a) => a.name && a.values.length);
    if (!defined.length) {
      setError({ message: "Escribe al menos un atributo con valores separados por coma, p. ej. Talla: CH, M, G." });
      return;
    }
    const combos = cartesian(defined);
    if (combos.length > 200) {
      setError({ message: `Se generarían ${combos.length} variantes; el máximo es 200.` });
      return;
    }
    setError(null);
    const base = sku.trim() || slug(name) || "SKU";
    setRows((prev) =>
      combos.map((combo) => {
        const key = defined.map((d) => combo[d.name]).join("|");
        const existing = prev.find((r) => r.key === key);
        return (
          existing ?? {
            key,
            attributeValues: combo,
            sku: [base, ...defined.map((d) => slug(combo[d.name]))].join("-"),
            price,
            cost,
            barcodes: "",
            initialStock: "",
          }
        );
      }),
    );
  }

  function updateRow(i: number, patch: Partial<VariantRow>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const variants =
      kind === "simple"
        ? [{ sku: sku.trim(), attributeValues: {}, price, cost: cost || null, barcodes: splitCodes(codes), initialStock: initialStock || null, minStock: minStock || null, reorderPoint: reorderPoint || null }]
        : rows.map((r) => ({ sku: r.sku.trim(), attributeValues: r.attributeValues, price: r.price, cost: r.cost || null, barcodes: splitCodes(r.barcodes), initialStock: r.initialStock || null, minStock: null, reorderPoint: null }));
    if (kind === "variable" && variants.length === 0) {
      setError({ message: "Genera las variantes antes de guardar." });
      return;
    }
    const payload = {
      name,
      sku: sku.trim(),
      description,
      kind,
      categoryName,
      brandName,
      unitId,
      taxProfileId,
      trackStock,
      isFavorite,
      satProductCode,
      attributeNames: kind === "variable" ? Object.keys(variants[0].attributeValues) : [],
      variants,
    };
    start(async () => {
      const res = await createProductAction(payload);
      if (res.ok) router.push(`/catalogo/${res.data.id}?creado=1`);
      else setError({ message: res.error, fields: res.fieldErrors });
    });
  }

  const fieldErr = (k: string) => error?.fields?.[k]?.join(" ");
  const inputCls = (k: string) => `field ${fieldErr(k) ? "field-error" : ""}`;

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error && (
        <Alert tone="danger" title={error.message}>
          {error.fields && Object.keys(error.fields).length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {Object.entries(error.fields).map(([k, v]) => (
                <li key={k}>{labelFor(k)}: {v.join(" ")}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      <Card title="Datos generales">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" required error={fieldErr("name")}>
            <input className={inputCls("name")} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => !sku && name && setSku(slug(name))} autoFocus />
          </Field>
          <Field label="SKU" required error={fieldErr("sku")} hint="Código interno único. Se sugiere a partir del nombre.">
            <input className={inputCls("sku")} value={sku} onChange={(e) => setSku(e.target.value.toUpperCase())} autoCapitalize="characters" />
          </Field>
          <Field label="Categoría" hint="Escribe una nueva o elige una existente.">
            <input className="field" list="cat-list" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} />
            <datalist id="cat-list">{categories.map((c) => <option key={c.id} value={c.name} />)}</datalist>
          </Field>
          <Field label="Marca">
            <input className="field" list="brand-list" value={brandName} onChange={(e) => setBrandName(e.target.value)} />
            <datalist id="brand-list">{brands.map((b) => <option key={b.id} value={b.name} />)}</datalist>
          </Field>
          <Field label="Unidad de venta" required>
            <select className="field" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code}){u.allowsDecimals ? " · admite decimales" : ""}</option>)}
            </select>
          </Field>
          <Field label="Impuesto" required hint="Los precios se capturan con el impuesto incluido.">
            <select className="field" value={taxProfileId} onChange={(e) => setTaxProfileId(e.target.value)}>
              {taxes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Descripción">
              <textarea className="field min-h-20" value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
          <Field label="Clave SAT de producto" hint="Opcional; para facturación (p. ej. 50202301).">
            <input className="field" value={satProductCode} onChange={(e) => setSatProductCode(e.target.value)} inputMode="numeric" />
          </Field>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={trackStock} onChange={(e) => setTrackStock(e.target.checked)} /> Controlar inventario</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={isFavorite} onChange={(e) => setIsFavorite(e.target.checked)} /> Mostrar en favoritos del punto de venta</label>
          </div>
        </div>
      </Card>

      <Card title="Tipo de producto">
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
          {(["simple", "variable"] as const).map((k) => (
            <label key={k} className={`flex cursor-pointer items-start gap-3 rounded-app border p-3 ${kind === k ? "border-primary bg-primary/10" : "border-border"}`}>
              <input type="radio" name="kind" className="mt-1 accent-primary" checked={kind === k} onChange={() => setKind(k)} />
              <span>
                <span className="block font-medium">{k === "simple" ? "Producto simple" : "Producto con variantes"}</span>
                <span className="block text-xs text-muted">{k === "simple" ? "Un solo precio y existencia (p. ej. refresco 600 ml)." : "Tallas, colores, presentaciones… cada una con su SKU, precio, código e inventario."}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>

      {kind === "simple" ? (
        <Card title="Precio, costo e inventario">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Precio de venta" required error={fieldErr("variants.0.price")}>
              <MoneyInput value={price} onChange={setPrice} />
            </Field>
            {canCost && (
              <Field label="Costo unitario" hint="Sin costo, la utilidad se marca incompleta." error={fieldErr("variants.0.cost")}>
                <MoneyInput value={cost} onChange={setCost} />
              </Field>
            )}
            <Field label="Códigos de barras" hint="Separados por coma o espacio. Puedes escanearlos aquí." error={fieldErr("variants.0.barcodes")}>
              <input className="field" value={codes} onChange={(e) => setCodes(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setCodes((c) => (c ? c + ", " : c)); } }} />
            </Field>
            {trackStock && canStock && (
              <Field label={`Existencia inicial${branchName ? ` (${branchName})` : ""}`} hint={unit?.allowsDecimals ? "Admite decimales." : "Piezas enteras."}>
                <input className="field" inputMode="decimal" value={initialStock} onChange={(e) => setInitialStock(e.target.value)} />
              </Field>
            )}
            {trackStock && (
              <>
                <Field label="Existencia mínima"><input className="field" inputMode="decimal" value={minStock} onChange={(e) => setMinStock(e.target.value)} /></Field>
                <Field label="Punto de reorden" hint="Alerta cuando la existencia llegue aquí."><input className="field" inputMode="decimal" value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} /></Field>
              </>
            )}
          </div>
        </Card>
      ) : (
        <Card title="Variantes">
          <p className="mb-3 text-sm text-muted">Define hasta 3 atributos con sus valores separados por coma y genera las combinaciones. Después ajusta SKU, precio, costo, código y existencia de cada una.</p>
          <div className="space-y-2">
            {attrs.map((a, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
                <input className="field" placeholder="Atributo (p. ej. Talla)" value={a.name} onChange={(e) => setAttrs((as) => as.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label={`Atributo ${i + 1}`} />
                <input className="field" placeholder="Valores separados por coma (p. ej. CH, M, G)" value={a.values} onChange={(e) => setAttrs((as) => as.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)))} aria-label={`Valores del atributo ${i + 1}`} />
                <Button type="button" variant="ghost" onClick={() => setAttrs((as) => as.filter((_, j) => j !== i))} aria-label="Quitar atributo"><Trash2 className="size-4" /></Button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {attrs.length < 3 && <Button type="button" variant="secondary" onClick={() => setAttrs((as) => [...as, { name: "", values: "" }])}><Plus className="size-4" /> Atributo</Button>}
            <Button type="button" variant="secondary" onClick={generate}><Wand2 className="size-4" /> Generar variantes</Button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Precio base para nuevas variantes"><MoneyInput value={price} onChange={setPrice} /></Field>
            {canCost && <Field label="Costo base para nuevas variantes"><MoneyInput value={cost} onChange={setCost} /></Field>}
          </div>

          {rows.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded-app border border-border">
              <table className="table">
                <thead>
                  <tr>
                    <th>Variante</th>
                    <th>SKU</th>
                    <th>Precio</th>
                    {canCost && <th>Costo</th>}
                    <th>Código(s)</th>
                    {trackStock && canStock && <th>Exist. inicial</th>}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.key}>
                      <td className="whitespace-nowrap font-medium">{attrNames.map((n) => r.attributeValues[n]).filter(Boolean).join(" / ")}</td>
                      <td><input className={`${inputCls(`variants.${i}.sku`)} !min-h-9 w-36 !py-1 font-mono text-xs`} value={r.sku} onChange={(e) => updateRow(i, { sku: e.target.value.toUpperCase() })} aria-label="SKU" /></td>
                      <td><MoneyInput small value={r.price} onChange={(v) => updateRow(i, { price: v })} /></td>
                      {canCost && <td><MoneyInput small value={r.cost} onChange={(v) => updateRow(i, { cost: v })} /></td>}
                      <td><input className="field !min-h-9 w-36 !py-1 text-xs" value={r.barcodes} onChange={(e) => updateRow(i, { barcodes: e.target.value })} aria-label="Códigos de barras" /></td>
                      {trackStock && canStock && <td><input className="field !min-h-9 w-20 !py-1" inputMode="decimal" value={r.initialStock} onChange={(e) => updateRow(i, { initialStock: e.target.value })} aria-label="Existencia inicial" /></td>}
                      <td><Button type="button" variant="ghost" className="!min-h-9 !px-2" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label="Quitar variante"><Trash2 className="size-4" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar producto"}</Button>
        <ButtonLink variant="ghost" href="/catalogo">Cancelar</ButtonLink>
      </div>
    </form>
  );
}

function labelFor(key: string) {
  const m = key.match(/^variants\.(\d+)\.(\w+)/);
  const names: Record<string, string> = { sku: "SKU", price: "Precio", cost: "Costo", barcodes: "Códigos", attributeValues: "Atributos", initialStock: "Existencia" };
  if (m) return `Variante ${Number(m[1]) + 1} · ${names[m[2]] ?? m[2]}`;
  const top: Record<string, string> = { name: "Nombre", sku: "SKU", unitId: "Unidad", taxProfileId: "Impuesto", attributeNames: "Atributos", variants: "Variantes", trackStock: "Inventario", _: "Detalle" };
  return top[key] ?? key;
}

export function Field({ label, hint, error, required, children }: { label: string; hint?: string; error?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-sm font-medium">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      {children}
      {error ? <span className="block text-xs text-danger">{error}</span> : hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function MoneyInput({ value, onChange, small }: { value: string; onChange: (v: string) => void; small?: boolean }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">$</span>
      <input
        className={`field pl-7 ${small ? "!min-h-9 w-28 !py-1" : ""}`}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.,]/g, ""))}
        placeholder="0.00"
      />
    </div>
  );
}
