import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/server/context";
import { hasPermission } from "@/server/authz/guard";
import { listRegistersWithStatus } from "@/server/modules/cash/service";
import { PosApp, type PosInitial } from "./pos-app";

export const metadata: Metadata = { title: "Punto de venta" };
export const dynamic = "force-dynamic";

export default async function PosPage() {
  const ctx = await requirePagePermission("pos.sell");
  if (ctx.user.mustChangePassword) redirect("/cambiar-contrasena");
  if (!ctx.company || !ctx.branch) redirect("/");
  const regs = await listRegistersWithStatus(ctx, ctx.branch.id);
  const branchRow = ctx.branches.find((b) => b.id === ctx.branch!.id)!;
  const initial: PosInitial = {
    tenantId: ctx.tenantId,
    user: { id: ctx.userId, fullName: ctx.user.fullName },
    company: {
      tradeName: ctx.company.tradeName,
      legalName: ctx.company.legalName,
      taxId: ctx.company.taxId,
      address: ctx.company.address as Record<string, string | undefined>,
      currency: ctx.company.currency,
      timezone: ctx.company.timezone,
      maxDiscountPercent: ctx.company.settings?.promotions?.maxDiscountPercent ?? 100,
    },
    branch: { id: branchRow.id, name: branchRow.name },
    registers: regs.map(({ register, session, openedByName }) => ({
      id: register.id,
      code: register.code,
      name: register.name,
      session: session ? { id: session.id, openedAt: session.openedAt.toISOString(), openedByName } : null,
    })),
    can: {
      discount: hasPermission(ctx, "pos.discount"),
      editPrice: hasPermission(ctx, "pos.edit_price"),
      openCash: hasPermission(ctx, "cash.open"),
      customers: hasPermission(ctx, "customers.view"),
      createCustomers: hasPermission(ctx, "customers.manage"),
      creditSale: hasPermission(ctx, "pos.credit_sale"),
      creditModule: ctx.enabledModules.has("credit"),
      abono: ctx.enabledModules.has("credit") && hasPermission(ctx, "credit.view"),
      returns: hasPermission(ctx, "returns.create"),
      authorizeReturns: hasPermission(ctx, "returns.authorize"),
      noTicketReturns: hasPermission(ctx, "returns.no_ticket"),
    },
    loadedAt: new Date().toISOString(),
  };
  return <PosApp initial={initial} />;
}
