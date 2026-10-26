"use server";

import { revalidatePath } from "next/cache";
import { requireActionContext } from "@/server/context";
import { toActionError, type ActionResult } from "@/server/errors";
import { formToObject } from "@/server/validation";
import { createUser, resetUserPassword, setUserAccess, setUserActive, updateUser } from "@/server/modules/users/service";

type R = Promise<ActionResult<unknown>>;

export async function createUserAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  try {
    const ctx = await requireActionContext();
    const o = formToObject(formData);
    const r = await createUser(ctx, { ...o, branchIds: (o.branchIds as string[] | undefined) ?? [] });
    revalidatePath("/usuarios");
    return { ok: true, data: { id: r.user.id, username: r.user.username, temporaryPassword: r.temporaryPassword } };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateUserAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  try {
    const ctx = await requireActionContext();
    await updateUser(ctx, String(formData.get("id")), formToObject(formData));
    revalidatePath("/usuarios");
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}

export async function setUserAccessAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  try {
    const ctx = await requireActionContext();
    const o = formToObject(formData);
    await setUserAccess(ctx, String(o.id), { roleId: o.roleId, branchIds: (o.branchIds as string[] | undefined) ?? [] });
    revalidatePath("/usuarios");
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}

export async function setUserActiveAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  try {
    const ctx = await requireActionContext();
    await setUserActive(ctx, String(formData.get("id")), formData.get("active") === "true", String(formData.get("reason") ?? "") || undefined);
    revalidatePath("/usuarios");
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}

export async function resetUserPasswordAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  try {
    const ctx = await requireActionContext();
    const r = await resetUserPassword(ctx, String(formData.get("id")));
    revalidatePath("/usuarios");
    return { ok: true, data: r };
  } catch (err) {
    return toActionError(err);
  }
}
