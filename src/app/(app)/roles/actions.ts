"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActionContext } from "@/server/context";
import { toActionError, type ActionResult } from "@/server/errors";
import { formToObject } from "@/server/validation";
import { createRole, deactivateRole, updateRole } from "@/server/modules/roles/service";

type R = Promise<ActionResult<unknown>>;

export async function createRoleAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  let id: string;
  try {
    const ctx = await requireActionContext();
    const o = formToObject(formData);
    id = (await createRole(ctx, { ...o, permissions: (o.permissions as string[] | undefined) ?? [] })).id;
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/roles");
  redirect(`/roles/${id}`);
}

export async function updateRoleAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  try {
    const ctx = await requireActionContext();
    const o = formToObject(formData);
    await updateRole(ctx, String(o.id), { ...o, permissions: (o.permissions as string[] | undefined) ?? [] });
    revalidatePath("/roles");
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}

export async function deactivateRoleAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  try {
    const ctx = await requireActionContext();
    await deactivateRole(ctx, String(formData.get("id")), String(formData.get("reason") ?? "") || undefined);
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/roles");
  redirect("/roles");
}
