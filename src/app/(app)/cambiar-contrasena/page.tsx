import type { Metadata } from "next";
import { Alert, Card, PageHeader } from "@/components/ui";
import { AppForm, FormField, Input, SubmitButton } from "@/components/ui/form";
import { requireContext } from "@/server/context";
import { changePasswordAction } from "../actions";

export const metadata: Metadata = { title: "Cambiar contraseña" };

export default async function ChangePasswordPage() {
  const ctx = await requireContext();
  return (
    <>
      <PageHeader title="Cambiar contraseña" description="Al guardar, se cerrarán todas tus sesiones y deberás iniciar sesión de nuevo." />
      {ctx.user.mustChangePassword && (
        <div className="mb-4"><Alert tone="warning" title="Debes cambiar tu contraseña temporal antes de continuar." /></div>
      )}
      <Card className="max-w-md">
        <AppForm action={changePasswordAction} successMessage={null}>
          <FormField name="currentPassword" label="Contraseña actual" required><Input name="currentPassword" type="password" autoComplete="current-password" /></FormField>
          <FormField name="newPassword" label="Nueva contraseña" required hint="Mínimo 8 caracteres, con letras y números."><Input name="newPassword" type="password" autoComplete="new-password" /></FormField>
          <FormField name="confirmPassword" label="Confirmar nueva contraseña" required><Input name="confirmPassword" type="password" autoComplete="new-password" /></FormField>
          <SubmitButton>Cambiar contraseña</SubmitButton>
        </AppForm>
      </Card>
    </>
  );
}
