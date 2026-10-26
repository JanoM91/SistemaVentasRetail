"use client";

import { Alert, Button } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const forbidden = error.message.includes("No tienes permiso");
  return (
    <div className="space-y-3">
      <Alert tone={forbidden ? "warning" : "danger"} title={forbidden ? "Sin permiso" : "Ocurrió un error"}>
        {forbidden ? error.message : "Intenta de nuevo. Si persiste, revisa la bitácora o contacta a soporte."}
        {error.digest && <span className="block text-xs text-muted">Ref. {error.digest}</span>}
      </Alert>
      {!forbidden && <Button variant="secondary" onClick={reset}>Reintentar</Button>}
    </div>
  );
}
