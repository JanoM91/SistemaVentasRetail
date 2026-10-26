"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActionContext } from "@/server/context";
import { toActionError, type ActionResult } from "@/server/errors";
import { checkbox, formToObject } from "@/server/validation";
import {
  createBranch,
  createCashRegister,
  createWarehouse,
  deactivateCashRegister,
  setBranchActive,
  updateBranch,
  updateWarehouse,
} from "@/server/modules/branches/service";

type R = Promise<ActionResult<unknown>>;

export async function createBranchAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  let id: string;
  try {
    const ctx = await requireActionContext();
    id = (await createBranch(ctx, formToObject(formData))).id;
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/", "layout");
  redirect(`/sucursales/${id}`);
}

export async function updateBranchAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  try {
    const ctx = await requireActionContext();
    await updateBranch(ctx, String(formData.get("id")), formToObject(formData));
    revalidatePath("/", "layout");
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}

export async function setBranchActiveAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  try {
    const ctx = await requireActionContext();
    await setBranchActive(ctx, String(formData.get("id")), formData.get("active") === "true", String(formData.get("reason") ?? "") || undefined);
    revalidatePath("/", "layout");
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}

export async function createWarehouseAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  try {
    const ctx = await requireActionContext();
    const o = formToObject(formData);
    await createWarehouse(ctx, { ...o, isDefault: checkbox(o.isDefault), allowsNegativeStock: checkbox(o.allowsNegativeStock) });
    revalidatePath(`/sucursales/${o.branchId}`);
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateWarehouseAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  try {
    const ctx = await requireActionContext();
    const o = formToObject(formData);
    await updateWarehouse(ctx, String(o.id), { name: o.name, isDefault: checkbox(o.isDefault), allowsNegativeStock: checkbox(o.allowsNegativeStock) });
    revalidatePath(`/sucursales/${o.branchId}`);
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}

export async function createCashRegisterAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  try {
    const ctx = await requireActionContext();
    const o = formToObject(formData);
    await createCashRegister(ctx, o);
    revalidatePath(`/sucursales/${o.branchId}`);
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}

export async function deactivateCashRegisterAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  try {
    const ctx = await requireActionContext();
    await deactivateCashRegister(ctx, String(formData.get("id")), String(formData.get("reason") ?? "") || undefined);
    revalidatePath(`/sucursales/${formData.get("branchId")}`);
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}
