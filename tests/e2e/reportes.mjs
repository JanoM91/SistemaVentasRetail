/**
 * Recorrido E2E de Fase 5A: tablero de reportes con filtros por periodo y
 * sucursal, pestañas, exportación a Excel/CSV/PDF, indicadores de «Hoy» en
 * Inicio y bloqueo para el cajero.
 * Uso: BASE_URL=http://localhost:3100 node tests/e2e/reportes.mjs   (requiere semillas)
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
  await page.context().clearCookies();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
page.on("dialog", (d) => d.accept());

console.log("Cajero · una venta para el reporte");
await login(page, "cajero", "Cajero1234!");
check((await page.locator('nav a[href="/reportes"]').count()) === 0, "el cajero no ve Reportes en el menú");
await page.goto(`${BASE}/caja`);
if (await page.locator('input[name="openingAmount"]').count()) {
  await page.fill('input[name="openingAmount"]', "500");
  await page.click('button:has-text("Abrir caja")');
  await page.waitForURL(/\/caja\/[0-9a-f-]{36}$/);
}
await page.goto(`${BASE}/pos`);
await page.getByTestId("product-grid").waitFor();
await page.getByTestId("pos-search").fill("7500000000042");
await page.getByTestId("pos-search").press("Enter");
await page.getByTestId("charge").click();
await page.getByTestId("received").fill("50");
await page.getByTestId("confirm-sale").click();
await page.getByTestId("ticket").waitFor();
check(true, "venta registrada");
await page.goto(`${BASE}/reportes`);
check(page.url().includes("/sin-permiso"), "el cajero no puede abrir /reportes");
const denied = await page.request.get(`${BASE}/api/v1/reports/export?reporte=resumen&formato=csv`);
check(denied.status() === 403, `la API de exportación responde 403 al cajero (${denied.status()})`);

console.log("Gerente · tablero");
await login(page, "gerente", "Gerente1234!");
check((await page.getByTestId("home-today").count()) === 1, "Inicio muestra los indicadores de Hoy");
check(money(await page.getByTestId("home-today").locator("p.text-2xl").first().textContent()) > 0, "la venta neta de hoy es mayor a cero");
check((await page.locator('nav a[href="/reportes"]').count()) === 1, "el menú muestra Reportes");
await page.goto(`${BASE}/reportes?periodo=hoy`);
const kpis = await page.getByTestId("kpis").textContent();
check(money(await page.getByTestId("kpi-tickets").locator("p.text-2xl").textContent()) >= 1, "hoy hay al menos un ticket");
check(kpis.includes("Utilidad bruta"), "el gerente ve la utilidad bruta");
check((await page.locator('figure[aria-label="Venta por hora del día"] [role="listitem"]').count()) === 18, "un solo día se grafica por hora (6 a 23 h)");
await page.screenshot({ path: `${SHOTS}/80-reportes-hoy.png`, fullPage: true });

await page.getByLabel("Periodo").selectOption("30d");
await page.getByRole("button", { name: "Ver", exact: true }).click();
await page.waitForURL(/periodo=30d/);
check((await page.locator('figure[aria-label="Venta neta por día"] [role="listitem"]').count()) === 30, "30 días se grafican por día");
await page.locator('figure[aria-label="Venta neta por día"] [role="listitem"]').last().hover();
check((await page.locator("figure .shadow-lg").textContent()).includes("tickets"), "el tooltip muestra venta y tickets del día");
await page.screenshot({ path: `${SHOTS}/81-reportes-30d.png`, fullPage: true });

await page.getByLabel("Periodo").selectOption("");
await page.getByLabel("Desde").fill("2020-01-01");
await page.getByLabel("Hasta").fill("2020-01-31");
await page.getByRole("button", { name: "Ver", exact: true }).click();
await page.waitForURL(/desde=2020-01-01/);
check(money(await page.getByTestId("kpi-tickets").locator("p.text-2xl").textContent()) === 0, "un rango sin ventas muestra cero tickets");
check((await page.locator("main").textContent()).includes("2020"), "el encabezado muestra el rango personalizado");

console.log("Gerente · pestañas");
for (const [href, text] of [["/reportes/ventas", "Por forma de pago"], ["/reportes/productos", "Por producto"], ["/reportes/inventario", "Existencias y cobertura"], ["/reportes/clientes", "Mezcla de clientes"], ["/reportes/promociones", "Promociones aplicadas"], ["/reportes/caja", "Cortes Z"]]) {
  await page.goto(`${BASE}${href}?periodo=30d`);
  check((await page.locator("main").textContent()).includes(text), `${href} muestra «${text}»`);
}
await page.goto(`${BASE}/reportes/productos?periodo=30d`);
check((await page.locator("main").textContent()).includes("Utilidad"), "productos muestra la columna de utilidad");
await page.screenshot({ path: `${SHOTS}/82-reportes-productos.png`, fullPage: true });
await page.goto(`${BASE}/reportes/ventas?periodo=30d`);
await page.screenshot({ path: `${SHOTS}/83-reportes-ventas.png`, fullPage: true });

console.log("Gerente · exportaciones");
const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-xlsx").click()]);
const xlsxPath = `${SHOTS}/reporte-ventas.xlsx`;
await download.saveAs(xlsxPath);
const xlsx = fs.readFileSync(xlsxPath);
check(xlsx.subarray(0, 2).toString() === "PK" && /\.xlsx$/.test(download.suggestedFilename()), `descarga Excel válido (${download.suggestedFilename()})`);
const csvHref = await page.getByTestId("export-csv").getAttribute("href");
const csv = await page.request.get(`${BASE}${csvHref}`);
const csvText = await csv.text();
check(csv.ok() && csvText.includes("Por forma de pago") && csvText.includes("Efectivo"), "el CSV trae las mismas tablas");
const pdf = await page.request.get(`${BASE}${await page.getByTestId("export-pdf").getAttribute("href")}`);
check(pdf.ok() && (await pdf.body()).subarray(0, 4).toString() === "%PDF", "descarga PDF válido");
const inv = await page.request.get(`${BASE}/api/v1/reports/export?reporte=inventario&formato=csv`);
check(inv.ok() && (await inv.text()).includes("Días de cobertura"), "exporta el inventario");

console.log("Dueño · utilidad");
await login(page, "dueno", "Dueno1234!");
await page.goto(`${BASE}/reportes?periodo=7d`);
check((await page.getByTestId("kpi-profit").count()) === 1, "el dueño ve la utilidad bruta");

await browser.close();
if (failures.length) {
  console.log(`\n✘ ${failures.length} verificación(es) fallaron`);
  process.exit(1);
}
console.log("\n✔ Reportes y exportaciones: todo en orden");
