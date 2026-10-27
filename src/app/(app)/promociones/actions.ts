"use server";

import { revalidatePath } from "next/cache";
import { requireActionContext } from "@/server/context";
import { toActionError, type ActionResult } from "@/server/errors";
import { formToObject } from "@/server/validation";
import { createCoupons, createPromotion, savePriceList, setCouponActive, setPriceListItems, setPromotionActive, updatePromotion } from "@/server/modules/promotions/service";

type R<T = unknown> = Promise<ActionResult<T>>;
async function run<T>(fn: (ctx: Awaited<ReturnType<typeof requireActionContext>>) => Promise<T>, paths: string[] = []): R<T> {
  try {
    const ctx = await requireActionContext();
    const data = await fn(ctx);
    for (const p of paths) revalidatePath(p);
    return { ok: true, data };
  } catch (err) {
    return toActionError(err);
  }
}

export async function savePromotionAction(id: string | null, input: unknown): R<{ id: string }> {
  return run(async (ctx) => ({ id: (id ? await updatePromotion(ctx, id, input) : await createPromotion(ctx, input)).id }), ["/promociones"]);
}

export async function togglePromotionAction(_p: ActionResult<unknown> | null, fd: FormData): R {
  const id = String(fd.get("id"));
  return run(async (ctx) => { await setPromotionActive(ctx, id, fd.get("active") === "1"); }, ["/promociones", `/promociones/${id}`]);
}

export async function createCouponsAction(_p: ActionResult<unknown> | null, fd: FormData): R<{ count: number }> {
  const o = formToObject(fd);
  const id = String(o.promotionId);
  return run(async (ctx) => ({ count: (await createCoupons(ctx, id, o)).length }), [`/promociones/${id}`]);
}

export async function toggleCouponAction(_p: ActionResult<unknown> | null, fd: FormData): R {
  return run(async (ctx) => { await setCouponActive(ctx, String(fd.get("id")), fd.get("active") === "1"); }, [`/promociones/${fd.get("promotionId")}`]);
}

export async function savePriceListAction(_p: ActionResult<unknown> | null, fd: FormData): R<{ id: string }> {
  const o = formToObject(fd);
  const id = o.id ? String(o.id) : null;
  return run(async (ctx) => ({ id: (await savePriceList(ctx, id, { ...o, isActive: o.isActive === "on" || !id })).id }), ["/promociones/listas", ...(id ? [`/promociones/listas/${id}`] : [])]);
}

export async function savePriceItemsAction(id: string, items: Array<{ variantId: string; price: string }>): R<number> {
  return run((ctx) => setPriceListItems(ctx, id, { items }), [`/promociones/listas/${id}`, "/promociones/listas"]);
}
