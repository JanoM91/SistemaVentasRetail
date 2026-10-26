import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Ticket } from "@/components/pos/ticket";
import { requirePagePermission } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { getSale } from "@/server/modules/sales/service";
import { toTicketData } from "@/server/modules/sales/ticket";
import { AutoPrint } from "./auto-print";

export const metadata: Metadata = { title: "Ticket" };

export default async function TicketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ imprimir?: string }> }) {
  const ctx = await requirePagePermission("pos.sell");
  const { id } = await params;
  const { imprimir } = await searchParams;
  let d;
  try {
    d = await getSale(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  return (
    <>
      <Ticket t={toTicketData(d)} />
      <AutoPrint enabled={imprimir === "1"} />
    </>
  );
}
