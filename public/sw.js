/*
 * Service worker del POS (Caja · Exkalibur).
 * - Guarda la pantalla /pos y sus archivos estáticos para abrirla sin internet.
 * - Nunca guarda respuestas de la API ni páginas con datos sensibles distintas de /pos.
 * - Las ventas offline NO pasan por aquí: viven en IndexedDB y se sincronizan desde la página.
 */
const VERSION = "sc-pos-v1";
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(PAGES).then((c) => c.add(OFFLINE_URL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// La página del POS manda la lista de archivos que cargó para tenerlos disponibles offline.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "precache" || !Array.isArray(data.urls)) return;
  event.waitUntil(
    (async () => {
      const staticCache = await caches.open(STATIC);
      for (const url of data.urls) {
        try {
          const u = new URL(url, self.location.origin);
          if (u.origin !== self.location.origin) continue;
          if (u.pathname === "/pos") {
            // Primera visita: la página aún no pasaba por el service worker.
            const page = await fetch("/pos", { credentials: "same-origin" });
            if (page.ok && !page.redirected) await (await caches.open(PAGES)).put("/pos", page);
            continue;
          }
          if (!u.pathname.startsWith("/_next/static/")) continue;
          if (await staticCache.match(u.href)) continue;
          const res = await fetch(u.href, { credentials: "same-origin" });
          if (res.ok) await staticCache.put(u.href, res);
        } catch {
          /* se reintenta en la siguiente visita */
        }
      }
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // datos: siempre de la red

  // Archivos estáticos con hash: primero caché.
  if (url.pathname.startsWith("/_next/static/") || /\.(png|svg|ico|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === "navigate") {
    if (url.pathname === "/pos") {
      // Primero red (datos frescos de turno y permisos); sin red, la última versión guardada.
      event.respondWith(
        (async () => {
          try {
            const res = await fetch(req);
            if (res.ok && !res.redirected) (await caches.open(PAGES)).put("/pos", res.clone());
            return res;
          } catch {
            const cached = await caches.match("/pos");
            return cached || caches.match(OFFLINE_URL);
          }
        })(),
      );
      return;
    }
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
  }
});
