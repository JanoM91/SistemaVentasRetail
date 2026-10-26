import { requireContext } from "@/server/context";

/** Layout mínimo para impresión (sin navegación). */
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  await requireContext();
  return <div className="min-h-dvh bg-white py-4 text-black">{children}</div>;
}
