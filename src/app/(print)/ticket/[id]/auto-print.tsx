"use client";

import { useEffect } from "react";

export function AutoPrint({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (enabled) setTimeout(() => window.print(), 300);
  }, [enabled]);
  return (
    <div className="mt-4 flex justify-center gap-2 print:hidden">
      <button className="rounded border px-3 py-2 text-sm" onClick={() => window.print()}>Imprimir</button>
      <button className="rounded border px-3 py-2 text-sm" onClick={() => history.back()}>Volver</button>
    </div>
  );
}
