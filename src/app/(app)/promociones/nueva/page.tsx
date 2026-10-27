import type { Metadata } from "next";
import { Alert, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/context";
import { promotionFormOptions } from "../data";
import { PromotionForm } from "../promotion-form";
import { EMPTY_PROMOTION } from "../promotion-values";

export const metadata: Metadata = { title: "Nueva promoción" };

export default async function NewPromotionPage() {
  const ctx = await requirePagePermission("promotions.manage");
  if (!ctx.company) return <Alert tone="warning">Selecciona una empresa.</Alert>;
  const opts = await promotionFormOptions(ctx);
  return (
    <>
      <PageHeader title="Nueva promoción" description="Se aplica sola en el punto de venta cuando se cumplen las condiciones." />
      <PromotionForm initial={EMPTY_PROMOTION} {...opts} currency={ctx.company.currency} />
    </>
  );
}
