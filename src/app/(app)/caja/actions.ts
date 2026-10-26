"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActionContext } from "@/server/context";
import { toActionError, type ActionResult } from "@/server/errors";
import { formToObject } from "@/server/validation";
import { addCashMovement, closeSession, openSession } from "@/server/modules/cash/service";

type R = Promise<ActionResult<unknown>>;

export async function openSessionAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  let id: string;
  try {
    const ctx = await requireActionContext();
    id = (await openSession(ctx, formToObject(formData))).id;
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/caja");
  redirect(formData.get("next") === "pos" ? "/pos" : `/caja/${id}`);
}

export async function cashMovementAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  try {
    const ctx = await requireActionContext();
    const o = formToObject(formData);
    await addCashMovement(ctx, { ...o, authorizerUsername: o.authorizerUsername || undefined, authorizerPassword: o.authorizerPassword || undefined });
    revalidatePath(`/caja/${o.cashSessionId}`);
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}

export async function closeSessionAction(input: { cashSessionId: string; denominations?: Record<string, number>; countedCash?: string; notes?: string }): Promise<ActionResult<unknown>> {
  try {
    const ctx = await requireActionContext();
    await closeSession(ctx, input);
    revalidatePath(`/caja/${input.cashSessionId}`);
    revalidatePath("/caja");
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}
