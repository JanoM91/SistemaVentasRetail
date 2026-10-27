/**
 * Recorrido E2E de Fase 4A: orden de compra → envío → recepción parcial con
 * flete → cierre → pago; traspaso entre sucursales con faltante; conteo físico
 * aplicado y sugerencias de compra.
 * Uso: BASE_URL=http://localhost:3100 node tests/e2e/compras.mjs   (requiere semillas)
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
async function login(page, username, password) {
  await page.context().clearCookies();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/`);
}
async function pick(page, term) {
  const box = page.getByLabel("Buscar producto");
  await box.fill(term);
  await page.locator('[role="listbox"] button').first().waitFor();
  await page.locator('[role="listbox"] button').first().click();
}
async function confirm(page, buttonLabel, reason) {
  await page.getByRole("button", { name: buttonLabel }).click();
  if (reason) await page.fill("#reason", reason);
  await page.getByRole("button", { name: "Confirmar" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
}
async function stockOf(page, sku, almLabel) {
  await page.goto(`${BASE}/inventario?q=${sku}`);
  if (almLabel) {
    await page.selectOption('select[name="alm"]', { label: almLabel });
    await page.getByRole("button", { name: "Ver" }).click();
    await page.waitForLoadState("networkidle");
  }
  const cell = page.locator("table tbody tr").first().locator("td").nth(1);
  return Number((await cell.textContent()).replace(/[^0-9.]/g, ""));
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

console.log("Gerente · orden de compra");
await login(page, "gerente", "Gerente1234!");
check((await page.locator('nav a[href="/compras"]').count()) === 1, "el menú muestra Compras");
const before = await stockOf(page, "AGUA-1L");

await page.goto(`${BASE}/compras/nueva`);
await page.getByLabel("Proveedor").selectOption({ label: "Distribuidora del Golfo" });
await pick(page, "AGUA-1L");
await page.waitForFunction(() => document.querySelector('input[aria-label^="Costo de"]')?.value !== "");
check((await page.locator('input[aria-label^="Costo de"]').inputValue()) !== "", "precarga el último costo del proveedor");
await page.fill('input[aria-label^="Cantidad de"]', "24");
await page.fill('input[aria-label^="Costo de"]', "6.50");
await page.getByRole("button", { name: "Guardar borrador" }).click();
await page.waitForURL(/\/compras\/[0-9a-f-]{36}$/);
const orderUrl = page.url();
const folio = (await page.locator("h1").textContent()).replace("Orden ", "").trim();
check(/^OC-\d+/.test(folio), `crea la orden en borrador con folio ${folio}`);
check((await page.locator("main").textContent()).includes("$180.96"), "total con IVA 24 × 6.50 = 156.00 + 24.96");

await confirm(page, "Enviar al proveedor");
await page.waitForSelector("text=Enviada");
check(true, "envía (autoriza) la orden");
await page.screenshot({ path: `${SHOTS}/40-orden-enviada.png`, fullPage: true });

console.log("Gerente · recepción parcial con flete");
await page.getByRole("link", { name: "Recibir mercancía" }).click();
await page.waitForURL(/\/recibir$/);
await page.fill('input[aria-label^="Recibido de"]', "20");
await page.getByRole("button", { name: "Agregar costo adicional" }).click();
await page.locator('input[aria-label="Concepto"]').fill("Flete");
await page.locator('input[aria-label="Concepto"]').locator("xpath=../div//input").fill("26.00");
await page.getByLabel("Fecha de la factura").fill("2026-10-20");
await page.screenshot({ path: `${SHOTS}/41-recepcion.png`, fullPage: true });
await page.getByRole("button", { name: "Registrar recepción" }).click();
await page.waitForURL(/\/compras\/recepciones\/[0-9a-f-]{36}\?nuevo=1$/);
const main = await page.locator("main").textContent();
const receiptFolio = (await page.locator("h1").textContent()).replace("Recepción ", "").trim();
check(main.includes("Mercancía recibida"), "registra la recepción");
check(main.includes("$176.80"), "total = 130.00 + IVA 20.80 + flete 26.00 = 176.80");
check(main.includes("$7.80"), "costo final con flete prorrateado = 6.50 + 26/20 = 7.80");
check(main.includes("2026-11-04"), "vence a 15 días de la factura");
await page.screenshot({ path: `${SHOTS}/42-recepcion-registrada.png`, fullPage: true });
check((await stockOf(page, "AGUA-1L")) === before + 20, "la existencia sube 20 unidades");

await page.goto(orderUrl);
check((await page.locator("text=Recibida parcial").count()) >= 1, "la orden queda como recibida parcial");
await confirm(page, "Cerrar con faltantes", "El proveedor ya no tiene más");
await page.waitForSelector("text=Orden cerrada con faltantes");
check(true, "cierra la orden con faltantes");

console.log("Gerente · pago a proveedor");
await page.goto(`${BASE}/compras/por-pagar`);
const row = page.locator("tr", { hasText: receiptFolio });
await row.getByRole("button", { name: "Pagar" }).click();
await page.fill('input[name="amount"]', "100");
await page.fill('input[name="reference"]', `E2E-${Date.now().toString(36)}`);
await page.getByRole("button", { name: "Registrar pago" }).click();
await page.waitForSelector("text=Pago registrado.");
await page.waitForTimeout(800);
await page.reload();
check((await page.locator("tr", { hasText: receiptFolio }).textContent()).includes("$76.80"), "el saldo baja a 76.80 tras un pago parcial");
await page.screenshot({ path: `${SHOTS}/43-por-pagar.png`, fullPage: true });

console.log("Gerente · traspaso a Sucursal Norte");
const centroBefore = await stockOf(page, "AGUA-1L");
await page.goto(`${BASE}/inventario/traspasos/nuevo`);
const dest = await page.getByLabel("Llega a").locator("option", { hasText: "Sucursal Norte" }).first().getAttribute("value");
await page.getByLabel("Llega a").selectOption(dest);
await pick(page, "AGUA-1L");
await page.fill('input[aria-label^="Envía de"]', "5");
await page.getByRole("button", { name: "Enviar traspaso" }).click();
await page.waitForURL(/\/inventario\/traspasos\/[0-9a-f-]{36}\?nuevo=1$/);
const transferUrl = page.url().split("?")[0];
check((await page.locator("text=En tránsito").count()) >= 1, "el traspaso queda en tránsito");
check((await page.locator("text=Solo un usuario de Sucursal Norte").count()) === 1, "el gerente de Centro no puede recibir en Norte");
check((await stockOf(page, "AGUA-1L")) === centroBefore - 5, "sale del origen al enviar");

console.log("Dueño · recibe el traspaso con faltante");
await login(page, "dueno", "Dueno1234!");
await page.goto(transferUrl);
await page.fill('input[aria-label^="Llegó de"]', "4");
await page.getByRole("button", { name: /Recibir con 1 diferencia/ }).click();
await page.waitForSelector("text=Recibido con 1 diferencia");
check(true, "recibe 4 de 5 y registra la diferencia");
await page.reload();
check((await page.locator("text=Recibido").count()) >= 1, "el traspaso queda recibido");
await page.screenshot({ path: `${SHOTS}/44-traspaso-recibido.png`, fullPage: true });

console.log("Gerente · conteo físico");
await login(page, "gerente", "Gerente1234!");
await page.goto(`${BASE}/inventario/conteos`);
// Si quedó un conteo abierto de una corrida anterior, se cancela.
const openRow = page.locator("tr", { hasText: "Abierto" }).first();
if (await openRow.count()) {
  await openRow.locator("a").click();
  await confirm(page, "Cancelar conteo", "Limpieza de prueba");
}
const aguaNow = await stockOf(page, "AGUA-1L");
await page.goto(`${BASE}/inventario/conteos/nuevo`);
await page.selectOption('select[name="categoryId"]', { label: "Bebidas" });
await page.getByRole("button", { name: "Iniciar conteo" }).click();
await page.waitForURL(/\/inventario\/conteos\/[0-9a-f-]{36}$/);
check((await page.locator("table tbody tr").count()) >= 3, "el conteo lista los productos de Bebidas");
await page.fill('input[aria-label^="Contado de Agua natural"]', String(aguaNow - 2));
await page.getByRole("button", { name: /Guardar captura/ }).click();
await page.waitForSelector("text=Se guardaron 1 producto(s).");
await page.reload();
check((await page.locator("tr", { hasText: "Agua natural" }).textContent()).includes("-2"), "muestra la diferencia de −2 al supervisor");
await page.screenshot({ path: `${SHOTS}/45-conteo.png`, fullPage: true });
await confirm(page, "Aplicar ajustes");
await page.reload();
check((await page.locator("text=Aplicado").count()) >= 1, "aplica el conteo");
check((await stockOf(page, "AGUA-1L")) === aguaNow - 2, "la existencia queda igual a lo contado");

console.log("Gerente · sugerencias de compra");
await page.goto(`${BASE}/compras/sugerencias`);
const hasFrijol = (await page.locator("tr", { hasText: "Frijol negro" }).count()) === 1;
check(hasFrijol, "sugiere Frijol (existencia 3, reorden 5)");
await page.screenshot({ path: `${SHOTS}/46-sugerencias.png`, fullPage: true });
if (hasFrijol) {
  await page.getByLabel("Seleccionar todo").uncheck();
  await page.getByLabel("Seleccionar Frijol negro 1 kg").check();
  await page.getByRole("button", { name: /Crear órdenes en borrador/ }).click();
  await page.waitForSelector("text=orden(es) en borrador");
  check((await page.locator('a[href^="/compras/"]', { hasText: /^OC-/ }).count()) >= 1, "crea la orden en borrador desde la sugerencia");
}

console.log("Cajero · sin acceso a compras");
await login(page, "cajero", "Cajero1234!");
check((await page.locator('nav a[href="/compras"]').count()) === 0, "el cajero no ve Compras en el menú");
await page.goto(`${BASE}/compras`);
check(page.url().includes("/sin-permiso"), "el cajero no puede abrir Compras por URL");

await browser.close();
if (failures.length) {
  console.log(`\n✘ ${failures.length} verificación(es) fallaron`);
  process.exit(1);
}
console.log("\n✔ Compras, traspasos y conteos: todo en orden");
