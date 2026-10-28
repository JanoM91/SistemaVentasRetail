import type { Metadata } from "next";
import { ReportPage } from "../report-page";
import type { ReportParams } from "../shell";

export const metadata: Metadata = { title: "Cortes de caja" };

export default function CashReport({ searchParams }: { searchParams: Promise<ReportParams> }) {
  return <ReportPage searchParams={searchParams} report="caja" />;
}
