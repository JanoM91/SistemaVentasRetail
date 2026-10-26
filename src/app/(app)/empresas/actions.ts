"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActionContext } from "@/server/context";
import { toActionError, type ActionResult } from "@/server/errors";
import { formToObject } from "@/server/validation";
import { createCompany, setCompanyActive, updateCompany } from "@/server/modules/companies/service";

type R = Promise<ActionResult<unknown>>;

export async function createCompanyAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  let id: string;
  try {
    const ctx = await requireActionContext();
    const company = await createCompany(ctx, formToObject(formData));
    id = company.id;
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/", "layout");
  redirect(`/empresas/${id}?creada=1`);
}

export async function updateCompanyAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  try {
    const ctx = await requireActionContext();
    const id = String(formData.get("id"));
    await updateCompany(ctx, id, formToObject(formData));
    revalidatePath("/", "layout");
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}

export async function setCompanyActiveAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  try {
    const ctx = await requireActionContext();
    const id = String(formData.get("id"));
    const active = formData.get("active") === "true";
    await setCompanyActive(ctx, id, active, String(formData.get("reason") ?? "") || undefined);
    revalidatePath("/", "layout");
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}
