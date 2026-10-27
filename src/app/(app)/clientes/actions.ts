"use server";

import { revalidatePath } from "next/cache";
import { requireActionContext } from "@/server/context";
import { toActionError, type ActionResult } from "@/server/errors";
import { formToObject } from "@/server/validation";
import { adjustCredit, createCustomer, registerCustomerPayment, saveGroup, setCreditTerms, setCustomerActive, updateCustomer } from "@/server/modules/customers/service";

type R<T = unknown> = Promise<ActionResult<T>>;

async function run<T>(fn: (ctx: Awaited<ReturnType<typeof requireActionContext>>) => Promise<T>, paths: string[] = []): R<T> {
  try {
    const ctx = await requireActionContext();
    const data = await fn(ctx);
    for (const p of paths) revalidatePath(p);
    return { ok: true, data };
  } catch (err) {
    return toActionError(err);
  }
}

export async function createCustomerAction(_p: ActionResult<unknown> | null, fd: FormData): R<{ id: string }> {
  const o = formToObject(fd);
  return run(async (ctx) => ({ id: (await createCustomer(ctx, o, { allowDuplicate: o.allowDuplicate === "1" })).id }), ["/clientes"]);
}

export async function updateCustomerAction(_p: ActionResult<unknown> | null, fd: FormData): R {
  const o = formToObject(fd);
  const id = String(o.id);
  return run(async (ctx) => { await updateCustomer(ctx, id, o); }, ["/clientes", `/clientes/${id}`]);
}

export async function toggleCustomerAction(_p: ActionResult<unknown> | null, fd: FormData): R {
  const id = String(fd.get("id"));
  return run(async (ctx) => { await setCustomerActive(ctx, id, fd.get("active") === "1", String(fd.get("reason") ?? "")); }, ["/clientes", `/clientes/${id}`]);
}

export async function creditTermsAction(_p: ActionResult<unknown> | null, fd: FormData): R {
  const o = formToObject(fd);
  const id = String(o.id);
  return run(async (ctx) => { await setCreditTerms(ctx, id, o); }, [`/clientes/${id}`, "/clientes/por-cobrar"]);
}

export async function customerPaymentAction(_p: ActionResult<unknown> | null, fd: FormData): R<{ id: string; folio: string | null }> {
  const o = formToObject(fd);
  return run(async (ctx) => {
    const r = await registerCustomerPayment(ctx, { ...o, cashRegisterId: "" });
    return { id: r.movement.id, folio: r.movement.folio };
  }, [`/clientes/${o.customerId}`, "/clientes/por-cobrar"]);
}

export async function creditAdjustmentAction(_p: ActionResult<unknown> | null, fd: FormData): R {
  const o = formToObject(fd);
  return run(async (ctx) => { await adjustCredit(ctx, o); }, [`/clientes/${o.customerId}`, "/clientes/por-cobrar"]);
}

export async function saveGroupAction(_p: ActionResult<unknown> | null, fd: FormData): R {
  const o = formToObject(fd);
  return run(async (ctx) => { await saveGroup(ctx, o.id ? String(o.id) : null, o); }, ["/clientes/grupos", "/clientes"]);
}
