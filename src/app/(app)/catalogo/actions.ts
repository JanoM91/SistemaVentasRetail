"use server";

import { revalidatePath } from "next/cache";
import { requireActionContext } from "@/server/context";
import { toActionError, type ActionResult } from "@/server/errors";
import { checkbox, formToObject } from "@/server/validation";
import { addVariant, createProduct, setProductActive, setVariantActive, updateProduct, updateVariant } from "@/server/modules/catalog/service";

type R<T = unknown> = Promise<ActionResult<T>>;

/** Recibe el producto como objeto (el formulario de variantes es dinámico). */
export async function createProductAction(input: unknown): R<{ id: string }> {
  try {
    const ctx = await requireActionContext();
    const r = await createProduct(ctx, input);
    revalidatePath("/catalogo");
    return { ok: true, data: { id: r.product.id } };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateProductAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  try {
    const ctx = await requireActionContext();
    const o = formToObject(formData);
    await updateProduct(ctx, String(o.id), { ...o, trackStock: checkbox(o.trackStock), isFavorite: checkbox(o.isFavorite) });
    revalidatePath(`/catalogo/${o.id}`);
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateVariantAction(variantId: string, productId: string, input: unknown): R {
  try {
    const ctx = await requireActionContext();
    await updateVariant(ctx, variantId, input);
    revalidatePath(`/catalogo/${productId}`);
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}

export async function addVariantAction(productId: string, input: unknown): R {
  try {
    const ctx = await requireActionContext();
    await addVariant(ctx, productId, input);
    revalidatePath(`/catalogo/${productId}`);
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}

export async function setProductActiveAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  try {
    const ctx = await requireActionContext();
    const id = String(formData.get("id"));
    await setProductActive(ctx, id, formData.get("active") === "true", String(formData.get("reason") ?? "") || undefined);
    revalidatePath(`/catalogo/${id}`);
    revalidatePath("/catalogo");
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}

export async function setVariantActiveAction(variantId: string, productId: string, active: boolean): R {
  try {
    const ctx = await requireActionContext();
    await setVariantActive(ctx, variantId, active);
    revalidatePath(`/catalogo/${productId}`);
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}
