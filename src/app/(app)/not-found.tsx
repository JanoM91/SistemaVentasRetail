import { ButtonLink, EmptyState } from "@/components/ui";

export default function NotFound() {
  return <EmptyState title="No encontrado" description="El registro no existe o no está disponible para tu cuenta." action={<ButtonLink href="/">Ir al inicio</ButtonLink>} />;
}
