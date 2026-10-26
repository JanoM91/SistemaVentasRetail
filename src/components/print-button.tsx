"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui";

export function PrintButton({ label = "Imprimir" }: { label?: string }) {
  return (
    <Button type="button" variant="secondary" className="print:hidden" onClick={() => window.print()}>
      <Printer className="size-4" /> {label}
    </Button>
  );
}
