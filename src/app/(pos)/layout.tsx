/** Layout del punto de venta: pantalla completa, sin navegación administrativa. */
export default function PosLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-dvh overflow-hidden bg-bg pt-[env(safe-area-inset-top)]">{children}</div>;
}
