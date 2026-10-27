"use server";

import { revalidatePath } from "next/cache";
import { requireActionContext } from "@/server/context";
import { toActionError, type ActionResult } from "@/server/errors";
import { checkbox, formToObject } from "@/server/validation";
import { setCompanyModules, updateCompanySettings } from "@/server/modules/companies/service";

type R = Promise<ActionResult<unknown>>;

export async function updateSettingsAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  try {
    const ctx = await requireActionContext();
    const o = formToObject(formData) as Record<string, Record<string, unknown>>;
    await updateCompanySettings(ctx, String(formData.get("companyId")), {
      inventory: { costingMethod: o.inventory?.costingMethod, allowNegativeStock: checkbox(o.inventory?.allowNegativeStock) },
      promotions: { allowStacking: checkbox(o.promotions?.allowStacking), maxDiscountPercent: o.promotions?.maxDiscountPercent },
      pos: { allowSaleWithoutCustomer: checkbox(o.pos?.allowSaleWithoutCustomer), requireCustomerForCredit: checkbox(o.pos?.requireCustomerForCredit) },
      notifications: { lowStockEmail: o.notifications?.lowStockEmail ?? "" },
      returns: { maxDays: o.returns?.maxDays ?? 30, allowWithoutTicket: checkbox(o.returns?.allowWithoutTicket), cashRefundNeedsAuthorization: checkbox(o.returns?.cashRefundNeedsAuthorization) },
    });
    revalidatePath("/configuracion");
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateModulesAction(_p: ActionResult<unknown> | null, formData: FormData): R {
  try {
    const ctx = await requireActionContext();
    await setCompanyModules(ctx, String(formData.get("companyId")), formData.getAll("modules[]").map(String));
    revalidatePath("/", "layout");
    return { ok: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}
