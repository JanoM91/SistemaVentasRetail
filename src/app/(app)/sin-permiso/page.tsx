import type { Metadata } from "next";
import { ButtonLink, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Sin permiso" };

export default async function ForbiddenPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p } = await searchParams;
  return (
    <EmptyState
      title="No tienes permiso para ver esta pantalla"
      description={p ? `Permiso requerido: ${p}. Pide a un administrador que lo agregue a tu rol.` : "Pide a un administrador que revise tu rol."}
      action={<ButtonLink href="/">Ir al inicio</ButtonLink>}
    />
  );
}
