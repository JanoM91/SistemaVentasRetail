import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getRequestContext } from "@/server/context";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; cuenta?: string }> }) {
  const ctx = await getRequestContext();
  if (ctx) redirect("/");
  const params = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-app bg-primary text-xl font-bold text-primary-fg">$</div>
          <h1 className="text-2xl font-semibold">Sistema de Caja</h1>
          <p className="mt-1 text-sm text-muted">Inicia sesión para continuar</p>
        </div>
        <LoginForm next={params.next} tenantSlug={params.cuenta} />
      </div>
    </main>
  );
}
