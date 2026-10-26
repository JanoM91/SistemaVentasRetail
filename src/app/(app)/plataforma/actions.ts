"use server";

import { revalidatePath } from "next/cache";
import { requireActionContext } from "@/server/context";
import { toActionError, type ActionResult } from "@/server/errors";
import { formToObject } from "@/server/validation";
import { createTenant, resetOwnerPassword, setTenantStatus } from "@/server/modules/platform/service";
import { setCompanyModules } from "@/server/modules/companies/service";

type R = Promise<ActionResult<unknown>>;

export async function createTenantAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  try {
    const ctx = await requireActionContext();
    const r = await createTenant(ctx, formToObject(formData));
    revalidatePath("/plataforma");
    return { ok: true, data: { id: r.tenant.id, slug: r.tenant.slug, username: r.owner.username, temporaryPassword: r.temporaryPassword } };
  } catch (err) {
    return toActionError(err);
  }
}

export async function setTenantStatusAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  try {
    const ctx = await requireActionContext();
    await setTenantStatus(ctx, String(formData.get("id")), formData.get("status") === "suspended" ? "suspended" : "active", String(formData.get("reason") ?? "") || undefined);
    revalidatePath("/plataforma");
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}

export async function resetOwnerPasswordAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  try {
    const ctx = await requireActionContext();
    const r = await resetOwnerPassword(ctx, String(formData.get("tenantId")), String(formData.get("userId")));
    return { ok: true, data: r };
  } catch (err) {
    return toActionError(err);
  }
}

export async function setTenantCompanyModulesAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  try {
    const ctx = await requireActionContext();
    await setCompanyModules(ctx, String(formData.get("companyId")), formData.getAll("modules[]").map(String), {
      permission: "platform.tenants.manage",
      tenantId: String(formData.get("tenantId")),
    });
    revalidatePath("/plataforma");
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}
