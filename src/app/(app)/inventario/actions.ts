"use server";

import { revalidatePath } from "next/cache";
import { requireActionContext } from "@/server/context";
import { toActionError, type ActionResult } from "@/server/errors";
import { registerAdjustment, reverseMovement } from "@/server/modules/inventory/service";
import { applyCount, cancelCount, cancelTransfer, createCount, createTransfer, receiveTransfer, recordCount } from "@/server/modules/inventory/operations";

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

// ---------------------------------------------------------------- Traspasos y conteos (Fase 4A)


export async function createTransferAction(input: unknown): Promise<ActionResult<{ id: string; folio: string }>> {
  try {
    const ctx = await requireActionContext();
    const t = await createTransfer(ctx, input);
    revalidatePath("/inventario/traspasos");
    revalidatePath("/inventario");
    return { ok: true, data: { id: t.id, folio: t.folio } };
  } catch (err) {
    return toActionError(err);
  }
}

export async function receiveTransferAction(id: string, input: unknown): Promise<ActionResult<{ differences: number }>> {
  try {
    const ctx = await requireActionContext();
    const r = await receiveTransfer(ctx, id, input);
    revalidatePath("/inventario/traspasos");
    revalidatePath(`/inventario/traspasos/${id}`);
    revalidatePath("/inventario");
    return { ok: true, data: { differences: r.differences.length } };
  } catch (err) {
    return toActionError(err);
  }
}

export async function cancelTransferAction(_p: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<unknown>> {
  try {
    const ctx = await requireActionContext();
    const id = String(fd.get("id"));
    await cancelTransfer(ctx, id, String(fd.get("reason") ?? ""));
    revalidatePath("/inventario/traspasos");
    revalidatePath(`/inventario/traspasos/${id}`);
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}

export async function createCountAction(_p: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireActionContext();
    const c = await createCount(ctx, { warehouseId: fd.get("warehouseId"), categoryId: fd.get("categoryId") ?? "", notes: fd.get("notes") ?? "" });
    revalidatePath("/inventario/conteos");
    return { ok: true, data: { id: c.id } };
  } catch (err) {
    return toActionError(err);
  }
}

export async function recordCountAction(id: string, entries: Array<{ variantId: string; countedQty: string }>): Promise<ActionResult<{ saved: number }>> {
  try {
    const ctx = await requireActionContext();
    const r = await recordCount(ctx, id, { entries });
    revalidatePath(`/inventario/conteos/${id}`);
    return { ok: true, data: r };
  } catch (err) {
    return toActionError(err);
  }
}

export async function applyCountAction(_p: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<unknown>> {
  try {
    const ctx = await requireActionContext();
    const id = String(fd.get("id"));
    const r = await applyCount(ctx, id, String(fd.get("reason") ?? "") || undefined);
    revalidatePath(`/inventario/conteos/${id}`);
    revalidatePath("/inventario/conteos");
    revalidatePath("/inventario");
    return { ok: true, data: r };
  } catch (err) {
    return toActionError(err);
  }
}

export async function cancelCountAction(_p: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<unknown>> {
  try {
    const ctx = await requireActionContext();
    const id = String(fd.get("id"));
    await cancelCount(ctx, id, String(fd.get("reason") ?? ""));
    revalidatePath(`/inventario/conteos/${id}`);
    revalidatePath("/inventario/conteos");
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}
