"use server";

import { revalidatePath } from "next/cache";
import { requireActionContext } from "@/server/context";
import { toActionError, type ActionResult } from "@/server/errors";
import { formToObject } from "@/server/validation";
import {
  cancelPurchaseOrder,
  costHints,
  createOrdersFromSuggestions,
  createPurchaseOrder,
  createSupplier,
  createSupplierReturn,
  payPayable,
  receivePurchase,
  sendPurchaseOrder,
  setSupplierActive,
  updatePurchaseOrder,
  updateSupplier,
} from "@/server/modules/purchasing/service";

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

// ---------------------------------------------------------------- Proveedores

function supplierFromForm(fd: FormData) {
  const o = formToObject(fd);
  return { ...o, address: (o.address as Record<string, string> | undefined) ?? undefined };
}

export async function createSupplierAction(_p: ActionResult<unknown> | null, fd: FormData): R<{ id: string }> {
  return run(async (ctx) => ({ id: (await createSupplier(ctx, supplierFromForm(fd))).id }), ["/compras/proveedores"]);
}

export async function updateSupplierAction(_p: ActionResult<unknown> | null, fd: FormData): R {
  const id = String(fd.get("id"));
  return run(async (ctx) => { await updateSupplier(ctx, id, supplierFromForm(fd)); }, ["/compras/proveedores", `/compras/proveedores/${id}`]);
}

export async function toggleSupplierAction(_p: ActionResult<unknown> | null, fd: FormData): R {
  const id = String(fd.get("id"));
  return run(async (ctx) => { await setSupplierActive(ctx, id, fd.get("active") === "1", String(fd.get("reason") ?? "")); }, ["/compras/proveedores", `/compras/proveedores/${id}`]);
}

// ---------------------------------------------------------------- Órdenes

export async function savePurchaseOrderAction(id: string | null, input: unknown): R<{ id: string; folio: string }> {
  return run(async (ctx) => {
    const po = id ? await updatePurchaseOrder(ctx, id, input) : await createPurchaseOrder(ctx, input);
    return { id: po.id, folio: po.folio };
  }, ["/compras"]);
}

export async function sendPurchaseOrderAction(_p: ActionResult<unknown> | null, fd: FormData): R {
  const id = String(fd.get("id"));
  return run((ctx) => sendPurchaseOrder(ctx, id), ["/compras", `/compras/${id}`]);
}

export async function cancelPurchaseOrderAction(_p: ActionResult<unknown> | null, fd: FormData): R {
  const id = String(fd.get("id"));
  return run((ctx) => cancelPurchaseOrder(ctx, id, String(fd.get("reason") ?? "")), ["/compras", `/compras/${id}`]);
}

export async function costHintsAction(supplierId: string | null, variantIds: string[]): R<Record<string, number | null>> {
  return run((ctx) => costHints(ctx, supplierId, variantIds));
}

// ---------------------------------------------------------------- Recepción / compra directa

export async function receivePurchaseAction(input: unknown): R<{ id: string; folio: string }> {
  return run(async (ctx) => {
    const r = await receivePurchase(ctx, input);
    return { id: r.id, folio: r.folio };
  }, ["/compras", "/compras/recepciones", "/compras/por-pagar", "/inventario"]);
}

// ---------------------------------------------------------------- Devoluciones a proveedor

export async function createSupplierReturnAction(input: unknown): R<{ folio: string; credit: number; pendingCredit: number }> {
  return run(async (ctx) => {
    const r = await createSupplierReturn(ctx, input);
    return { folio: r.folio, credit: r.creditAmount, pendingCredit: r.pendingCredit };
  }, ["/compras/devoluciones", "/compras/por-pagar", "/inventario"]);
}

// ---------------------------------------------------------------- Cuentas por pagar

export async function payPayableAction(_p: ActionResult<unknown> | null, fd: FormData): R<{ balance: number }> {
  return run((ctx) => payPayable(ctx, formToObject(fd)), ["/compras/por-pagar", "/compras/proveedores"]);
}

// ---------------------------------------------------------------- Sugerencias

export async function createOrdersFromSuggestionsAction(
  warehouseId: string,
  items: Array<{ variantId: string; quantity: number; supplierId: string; unitCost: string }>,
): R<Array<{ id: string; folio: string }>> {
  return run(async (ctx) => (await createOrdersFromSuggestions(ctx, warehouseId, items)).map((p) => ({ id: p.id, folio: p.folio })), ["/compras", "/compras/sugerencias"]);
}
