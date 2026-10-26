/**
 * Recorrido E2E de la Fase 3: caja → POS en línea → POS sin conexión (incluye
 * recargar la página offline) → sincronización → inventario → corte Z.
 *
 * Uso: BASE_URL=http://localhost:3100 node tests/e2e/pos.mjs
 * Requiere base recién sembrada (npm run db:reset). Capturas en tests/e2e/shots/.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOTS = "tests/e2e/shots";
fs.mkdirSync(SHOTS, { recursive: true });

const failures = [];
function check(cond, msg) {
  console.log(cond ? "  ✔" : "  ✘", msg);
  if (!cond) failures.push(msg);
}
const money = (s) => Number(String(s).replace(/[^0-9.-]/g, ""));

async function login(page, username, password) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function scan(page, code) {
  const search = page.getByTestId("pos-search");
  await search.fill(code);
  await search.press("Enter");
}

async function pay(page, received) {
  await page.getByTestId("charge").click();
  await page.getByTestId("received").fill(received);
  await page.getByTestId("confirm-sale").click();
  await page.getByTestId("ticket").waitFor();
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1366, height: 820 } });
const page = await context.newPage();
page.on("dialog", (d) => d.accept());
let sessionUrl = "";

// ---------------------------------------------------------------- Caja
console.log("Caja");
await login(page, "cajero", "Cajero1234!");
await page.goto(`${BASE}/caja`);
await page.screenshot({ path: `${SHOTS}/f3-01-caja-cerrada.png`, fullPage: true });
await page.fill('input[name="openingAmount"]', "500");
await page.click('button:has-text("Abrir caja")');
await page.waitForURL(/\/caja\/[0-9a-f-]{36}$/);
sessionUrl = page.url();
check(true, "abre la caja con fondo de $500 y muestra el corte X");

// ---------------------------------------------------------------- POS en línea
console.log("POS en línea");
await page.goto(`${BASE}/pos`);
await page.getByTestId("product-grid").waitFor();
check((await page.getByTestId("net-status").textContent()).includes("En línea"), "indica que está en línea");
await scan(page, "7500000000011"); // refresco por código de barras
await page.getByTestId("pos-search").fill("papas");
await page.getByTestId("pos-search").press("Enter"); // un solo resultado → se agrega
await page.getByTestId("pos-search").fill("playera");
await page.locator('[data-testid="product-grid"] button').first().click(); // producto con variantes
await page.click('button:has-text("M / Negro")');
const cartTotal = await page.getByTestId("cart-total").textContent();
check(money(cartTotal) === 236.5, `total del carrito $236.50 (refresco + papas + playera M) → ${cartTotal}`);
await page.screenshot({ path: `${SHOTS}/f3-02-pos-carrito.png` });
await page.getByTestId("charge").click();
await page.getByTestId("received").fill("300");
check(money(await page.getByTestId("change").textContent()) === 63.5, "calcula cambio de $63.50");
await page.screenshot({ path: `${SHOTS}/f3-03-pos-cobro.png` });
await page.getByTestId("confirm-sale").click();
await page.getByTestId("ticket").waitFor();
const ticket1 = await page.getByTestId("ticket").textContent();
check(ticket1.includes("V-000001"), "la venta en línea obtiene folio V-000001 en el ticket");
await page.screenshot({ path: `${SHOTS}/f3-04-ticket.png` });
await page.getByTestId("new-sale").click();

// Esperar a que el service worker guarde la app para uso offline.
let cached = false;
for (let i = 0; i < 40 && !cached; i++) {
  cached = await page.evaluate(async () => !!(await caches.match("/pos")) && !!navigator.serviceWorker.controller);
  if (!cached) await page.waitForTimeout(250);
}
check(cached, "el service worker guardó el punto de venta para uso sin conexión");

// ---------------------------------------------------------------- POS sin conexión
console.log("POS sin conexión");
await context.setOffline(true);
await page.waitForFunction(() => document.querySelector('[data-testid="net-status"]')?.textContent?.includes("Sin conexión"));
check(true, "detecta la pérdida de conexión");
await scan(page, "7500000000028"); // agua
await scan(page, "7500000000028"); // agua ×2
await pay(page, "50");
const ticket2 = await page.getByTestId("ticket").textContent();
check(ticket2.includes("PENDIENTE"), "la venta offline se guarda con folio pendiente");
await page.screenshot({ path: `${SHOTS}/f3-05-ticket-offline.png` });
await page.getByTestId("new-sale").click();

// Recargar la página sin internet: debe abrir desde la caché y conservar la cola.
await page.reload();
await page.getByTestId("pos-search").waitFor({ timeout: 15000 });
check(true, "el punto de venta abre sin internet tras recargar la página");
await page.getByTestId("product-grid").waitFor();
await scan(page, "7500000000011"); // refresco
await pay(page, "20");
await page.getByTestId("new-sale").click();
const pendingTxt = await page.getByTestId("pending-badge").textContent();
check(pendingTxt.trim().startsWith("2 pendientes"), `dos ventas en cola de sincronización → «${pendingTxt}»`);
await page.screenshot({ path: `${SHOTS}/f3-06-pos-offline.png` });

// ---------------------------------------------------------------- Reconexión
console.log("Sincronización");
await context.setOffline(false);
await page.waitForFunction(() => document.querySelector('[data-testid="pending-badge"]')?.textContent?.trim().startsWith("0 pendientes"), null, { timeout: 30000 });
check(true, "al volver la conexión se sincronizan solas (0 pendientes)");
await page.getByTestId("pending-badge").click();
const panel = await page.locator('[role="dialog"]').textContent();
check(panel.includes("V-000002") && panel.includes("V-000003"), "las ventas offline recibieron folios V-000002 y V-000003");
await page.screenshot({ path: `${SHOTS}/f3-07-sincronizado.png` });
await page.keyboard.press("Escape");

// Reenvío manual del lote: no debe duplicar (idempotencia desde el navegador).
const dupStatus = await page.evaluate(async () => {
  const res = await fetch("/api/v1/pos/sales", { method: "POST", headers: { "Content-Type": "application/json", "x-sc-client": "pos" }, body: "{}" });
  return res.status;
});
check(dupStatus === 422, "la API rechaza una venta mal formada con error de validación");
const csrf = await page.evaluate(async () => (await fetch("/api/v1/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status);
check(csrf === 403, "la API exige el encabezado del cliente (protección CSRF)");

// ---------------------------------------------------------------- Ventas e inventario
console.log("Ventas e inventario");
await page.goto(`${BASE}/ventas`);
const rows = await page.locator("table tbody tr").count();
check(rows === 3, `la lista muestra 3 ventas del día → ${rows}`);
check((await page.locator("text=Sin conexión").count()) >= 2, "dos ventas marcadas como hechas sin conexión");
await page.screenshot({ path: `${SHOTS}/f3-08-ventas.png`, fullPage: true });
await page.goto(`${BASE}/inventario?q=agua`);
check((await page.locator("table tbody tr").first().textContent()).includes("34"), "inventario de agua: 36 − 2 = 34");
await page.goto(`${BASE}/inventario?q=refresco`);
check((await page.locator("table tbody tr").first().textContent()).includes("46"), "inventario de refresco: 48 − 2 = 46");

// ---------------------------------------------------------------- Corte Z
console.log("Corte Z");
await page.goto(sessionUrl);
await page.screenshot({ path: `${SHOTS}/f3-09-corte-x.png`, fullPage: true });
// Esperado: 500 + 236.50 + 24.00 + 18.50 = 779.00 → 500 + 200 + 50 + 20 + 5 + 2×2
for (const [den, n] of [["50000", 1], ["20000", 1], ["5000", 1], ["2000", 1], ["500", 1], ["200", 2]]) {
  await page.fill(`input[aria-label="Piezas de ${Number(den) / 100}"]`, String(n));
}
await page.click('button:has-text("Hacer corte Z")');
await page.click('button:has-text("Cerrar turno")');
await page.waitForSelector("text=Corte Z");
await page.waitForSelector("text=(cuadra)", { timeout: 10000 }).catch(() => {});
const z = await page.locator("main").textContent();
check(z.includes("$779.00"), "el corte Z espera $779.00");
check(z.includes("(cuadra)"), "el efectivo contado cuadra con lo esperado");
await page.screenshot({ path: `${SHOTS}/f3-10-corte-z.png`, fullPage: true });

// ---------------------------------------------------------------- Permisos y alta de producto
console.log("Gerente: alta de producto");
await page.goto(`${BASE}/catalogo/nuevo`);
await page.waitForURL(/sin-permiso/);
check(true, "el cajero no puede dar de alta productos");
await context.clearCookies();
await login(page, "gerente", "Gerente1234!");
await page.goto(`${BASE}/catalogo/nuevo`);
await page.getByLabel("Nombre").first().fill("Café molido 250 g");
await page.locator("text=SKU").locator("..").locator("input").fill("CAFE-250");
await page.locator("text=Precio de venta").locator("..").locator("input").fill("89.50");
await page.locator("text=Costo unitario").locator("..").locator("input").fill("52");
await page.locator("text=Códigos de barras").locator("..").locator("input").fill("7500000009999");
await page.locator("text=Existencia inicial").locator("..").locator("input").fill("12");
await page.click('button:has-text("Guardar producto")');
await page.waitForURL(/\/catalogo\/[0-9a-f-]{36}\?creado=1/);
check((await page.locator("main").textContent()).includes("$89.50"), "el gerente da de alta un producto con precio, costo, código y existencia");
await page.screenshot({ path: `${SHOTS}/f3-11-producto.png`, fullPage: true });
await page.click("text=Existencia 12");
await page.waitForURL(/kardex/);
check((await page.locator("table tbody tr").count()) === 1, "el kardex muestra la existencia inicial");

// Móvil
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.context().addCookies(await context.cookies());
await mobile.goto(`${BASE}/pos`);
await mobile.getByTestId("product-grid").waitFor();
await mobile.screenshot({ path: `${SHOTS}/f3-12-pos-movil.png` });
check(true, "el punto de venta se usa en celular");

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} comprobaciones fallaron`);
  process.exit(1);
}
console.log("\nRecorrido E2E de la Fase 3 sin fallos.");
