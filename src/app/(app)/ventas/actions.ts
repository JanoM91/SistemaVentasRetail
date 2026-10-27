"use server";

import { revalidatePath } from "next/cache";
import { requireActionContext } from "@/server/context";
import { toActionError, type ActionResult } from "@/server/errors";
import { formToObject } from "@/server/validation";
import { cancelSale } from "@/server/modules/sales/service";
import { markSaleReviewed, resolveSyncEvent } from "@/server/modules/settings/service";

export async function cancelSaleAction(_p: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<unknown>> {
  try {
    const ctx = await requireActionContext();
    const o = formToObject(formData);
    await cancelSale(ctx, String(o.saleId), { reason: o.reason, authorizerUsername: o.authorizerUsername || undefined, authorizerPassword: o.authorizerPassword || undefined });
    revalidatePath(`/ventas/${o.saleId}`);
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}

export async function reviewSaleAction(_p: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<unknown>> {
  try {
    const ctx = await requireActionContext();
    await markSaleReviewed(ctx, String(formData.get("id")), { note: formData.get("note") });
    revalidatePath("/ventas/revision");
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}

export async function resolveSyncAction(_p: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<unknown>> {
  try {
    const ctx = await requireActionContext();
    await resolveSyncEvent(ctx, String(formData.get("id")), { note: formData.get("note") });
    revalidatePath("/ventas/revision");
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}
