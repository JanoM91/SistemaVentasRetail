"use server";

import { revalidatePath } from "next/cache";
import { requireActionContext } from "@/server/context";
import { toActionError, type ActionResult } from "@/server/errors";
import { registerAdjustment, reverseMovement } from "@/server/modules/inventory/service";

export async function registerAdjustmentAction(input: unknown): Promise<ActionResult<{ onHand: number }>> {
  try {
    const ctx = await requireActionContext();
    const r = await registerAdjustment(ctx, input);
    revalidatePath("/inventario");
    return { ok: true, data: { onHand: r.onHand } };
  } catch (err) {
    return toActionError(err);
  }
}

export async function reverseMovementAction(_p: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<unknown>> {
  try {
    const ctx = await requireActionContext();
    await reverseMovement(ctx, String(formData.get("ledgerId")), String(formData.get("reason") ?? ""));
    revalidatePath(`/inventario/kardex/${formData.get("variantId")}`);
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}
