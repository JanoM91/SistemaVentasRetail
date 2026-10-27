export const TRANSFER_STATUS = {
  in_transit: { tone: "warning", label: "En tránsito" },
  received: { tone: "success", label: "Recibido" },
  cancelled: { tone: "danger", label: "Cancelado" },
} as const;

export const COUNT_STATUS = {
  open: { tone: "warning", label: "Abierto" },
  applied: { tone: "success", label: "Aplicado" },
  cancelled: { tone: "danger", label: "Cancelado" },
} as const;
