"use client";

import { useState } from "react";

export function AuditDetails({ before, after, meta }: { before: unknown; after: unknown; meta: { ip: string | null; userAgent: string | null; deviceId: string | null; authorizedBy: string | null } }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="text-xs text-primary underline" onClick={() => setOpen((o) => !o)}>
        {open ? "Ocultar" : "Ver"}
      </button>
      {open && (
        <div className="mt-2 grid max-w-xl gap-2 text-xs">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <p className="font-semibold text-muted">Antes</p>
              <pre className="overflow-auto rounded bg-surface-2 p-2">{before ? JSON.stringify(before, null, 1) : "—"}</pre>
            </div>
            <div>
              <p className="font-semibold text-muted">Después</p>
              <pre className="overflow-auto rounded bg-surface-2 p-2">{after ? JSON.stringify(after, null, 1) : "—"}</pre>
            </div>
          </div>
          <p className="text-muted">IP {meta.ip ?? "—"} · Dispositivo {meta.deviceId ?? "—"} · {meta.userAgent ? meta.userAgent.slice(0, 80) : "—"}{meta.authorizedBy && ` · Autorizó ${meta.authorizedBy.slice(0, 8)}…`}</p>
        </div>
      )}
    </>
  );
}
