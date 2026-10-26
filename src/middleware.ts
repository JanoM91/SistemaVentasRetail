import { NextResponse, type NextRequest } from "next/server";

/**
 * Pasa la ruta actual al layout (x-pathname) y redirige al login cuando no hay
 * cookie de sesión. La validación real de la sesión ocurre en el servidor
 * (getRequestContext); aquí solo se evita renderizar páginas privadas sin cookie.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = pathname.startsWith("/login") || pathname.startsWith("/api/health");
  const hasSession = req.cookies.has("sc_session");
  if (!isPublic && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    return NextResponse.redirect(url);
  }
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons|manifest.webmanifest|sw.js).*)"],
};
