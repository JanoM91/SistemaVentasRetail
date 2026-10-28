import type { Metadata } from "next";
import { ReportPage } from "../report-page";
import type { ReportParams } from "../shell";

export const metadata: Metadata = { title: "Reporte de clientes" };

export default function CustomersReport({ searchParams }: { searchParams: Promise<ReportParams> }) {
  return <ReportPage searchParams={searchParams} report="clientes" />;
}
