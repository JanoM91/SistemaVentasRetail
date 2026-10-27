/**
 * Recorrido E2E de Fase 4B: cliente en la venta, pago dividido (tarjeta +
 * crédito con autorización), abono en caja que entra al corte, alta rápida
 * de cliente en el POS, ficha y cuentas por cobrar en el back-office.
 * Uso: BASE_URL=http://localhost:3100 node tests/e2e/clientes.mjs   (requiere semillas)
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
async function pickCustomer(page, term, name) {
  await page.getByLabel("Buscar cliente").fill(term);
  await page.locator('[data-testid="customer-results"] button', { hasText: name }).first().click();
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
page.on("dialog", (d) => d.accept());

console.log("Cajero · caja");
await login(page, "cajero", "Cajero1234!");
await page.goto(`${BASE}/caja`);
if (await page.locator('input[name="openingAmount"]').count()) {
  await page.fill('input[name="openingAmount"]', "500");
  await page.click('button:has-text("Abrir caja")');
  await page.waitForURL(/\/caja\/[0-9a-f-]{36}$/);
} else {
  await page.locator('a[href^="/caja/"]').first().click();
  await page.waitForURL(/\/caja\/[0-9a-f-]{36}$/);
}
const sessionUrl = page.url();
const cashBefore = money(await page.locator("tr", { hasText: "Abonos en efectivo" }).locator("td").nth(1).textContent().catch(() => "0"));
check(true, "turno de caja abierto");

console.log("Cajero · venta con cliente, tarjeta + crédito autorizado");
await page.goto(`${BASE}/pos`);
await page.getByTestId("product-grid").waitFor();
for (let i = 0; i < 2; i++) {
  await page.getByTestId("pos-search").fill("7500000000011");
  await page.getByTestId("pos-search").press("Enter");
}
check(money(await page.getByTestId("cart-total").textContent()) === 37, "carrito de $37.00");
await page.getByTestId("add-customer").click();
await pickCustomer(page, "esquina", "Tienda La Esquina");
const chip = await page.getByTestId("sale-customer").textContent();
check(chip.includes("Tienda La Esquina") && chip.includes("Crédito disponible"), "asocia el cliente y muestra su crédito disponible");
await page.getByTestId("charge").click();
await page.getByRole("button", { name: "Tarjeta de débito" }).click();
await page.getByTestId("tender-amount").fill("20");
await page.getByTestId("tender-reference").fill("AUT123");
await page.getByTestId("add-tender").click();
check(money(await page.getByTestId("pay-remaining").textContent()) === 17, "registra $20 en tarjeta y faltan $17");
await page.getByRole("button", { name: "Crédito del cliente" }).click();
check((await page.locator("text=Vender a crédito requiere autorización").count()) === 1, "el cajero necesita autorización para vender a crédito");
await page.getByLabel("Usuario autorizador").fill("gerente");
await page.getByLabel("Contraseña del autorizador").fill("Gerente1234!");
await page.screenshot({ path: `${SHOTS}/50-cobro-dividido-credito.png` });
await page.getByTestId("confirm-sale").click();
await page.getByTestId("ticket").waitFor();
const ticket = await page.getByTestId("ticket").textContent();
check(ticket.includes("Cliente: Tienda La Esquina"), "el ticket lleva el cliente");
check(ticket.includes("VENTA A CRÉDITO") && ticket.includes("$17.00"), "el ticket muestra el importe a crédito y línea de firma");
check(ticket.includes("Tarjeta de débito (AUT123)"), "el ticket lista ambos pagos");
await page.screenshot({ path: `${SHOTS}/51-ticket-credito.png` });
await page.getByTestId("new-sale").click();

console.log("Cajero · abono en caja");
await page.getByTestId("abono-button").click();
await pickCustomer(page, "esquina", "Tienda La Esquina");
const balance = money(await page.getByTestId("abono-balance").textContent());
check(balance >= 17, `muestra el saldo del cliente (${balance})`);
await page.getByTestId("abono-amount").fill("10");
await page.getByLabel("Efectivo recibido").fill("20");
await page.getByTestId("confirm-abono").click();
await page.getByTestId("abono-ticket").waitFor();
const abono = await page.getByTestId("abono-ticket").textContent();
check(/AB-\d{6}/.test(abono), "emite comprobante de abono con folio AB");
check(abono.includes(`Saldo actual$${(balance - 10).toFixed(2)}`) || abono.includes(`$${(balance - 10).toFixed(2)}`), "el saldo baja $10");
await page.screenshot({ path: `${SHOTS}/52-abono.png` });
await page.getByRole("button", { name: "Listo" }).click();

console.log("Cajero · alta rápida de cliente en el POS");
const phone = `228${String(Date.now()).slice(-7)}`;
await page.getByTestId("pos-search").fill("7500000000011");
await page.getByTestId("pos-search").press("Enter");
await page.getByTestId("add-customer").click();
await page.getByLabel("Buscar cliente").fill("Pedro Prueba");
await page.getByRole("button", { name: "Nuevo cliente" }).click();
await page.getByLabel("Teléfono (10 dígitos)").fill(phone);
await page.getByRole("button", { name: "Crear y usar" }).click();
await page.getByTestId("sale-customer").waitFor();
check((await page.getByTestId("sale-customer").textContent()).includes("Pedro Prueba"), "crea el cliente desde caja y lo asocia a la venta");
await page.getByTestId("charge").click();
await page.getByTestId("received").fill("20");
await page.getByTestId("confirm-sale").click();
await page.getByTestId("ticket").waitFor();
await page.getByTestId("new-sale").click();

console.log("Cajero · corte de caja");
await page.goto(sessionUrl);
const corte = await page.locator("main").textContent();
check(corte.includes("Abonos de clientes"), "el corte lista los abonos de clientes");
const cashAfter = money(await page.locator("tr", { hasText: "Abonos en efectivo" }).locator("td").nth(1).textContent());
check(cashAfter - cashBefore === 10, "el abono en efectivo suma al efectivo esperado");
await page.screenshot({ path: `${SHOTS}/53-corte-abonos.png`, fullPage: true });

console.log("Gerente · ficha del cliente y por cobrar");
await login(page, "gerente", "Gerente1234!");
check((await page.locator('nav a[href="/clientes"]').count()) === 1, "el menú muestra Clientes");
await page.goto(`${BASE}/clientes?q=esquina`);
await page.getByRole("link", { name: "Tienda La Esquina" }).click();
await page.waitForURL(/\/clientes\/[0-9a-f-]{36}$/);
check(money(await page.getByTestId("customer-balance").textContent()) === balance - 10, "la ficha muestra el saldo actualizado");
const prof = await page.locator("main").textContent();
check(prof.includes("Compra a crédito") && prof.includes("Abono"), "el estado de cuenta muestra el cargo y el abono");
check(prof.includes("Lo que más compra") && prof.includes("REF-COLA-600"), "muestra el historial y lo que más compra");
await page.screenshot({ path: `${SHOTS}/54-ficha-cliente.png`, fullPage: true });

await page.goto(`${BASE}/clientes?q=Mar%C3%ADa`);
await page.getByRole("link", { name: "María Fernández" }).click();
await page.waitForURL(/\/clientes\/[0-9a-f-]{36}$/);
await page.getByLabel("Puede comprar a crédito").check();
await page.fill('input[name="creditLimit"]', "300");
await page.fill('input[name="creditDays"]', "10");
await page.getByRole("button", { name: "Guardar condiciones" }).click();
await page.waitForSelector("text=Condiciones de crédito guardadas.");
check(true, "el gerente otorga crédito a un cliente");

await page.goto(`${BASE}/clientes/por-cobrar`);
check((await page.locator("tr", { hasText: "Tienda La Esquina" }).count()) === 1, "por cobrar lista al cliente con saldo");
await page.screenshot({ path: `${SHOTS}/55-por-cobrar.png`, fullPage: true });
await page.goto(`${BASE}/clientes?segmento=marketing`);
check((await page.locator("tr", { hasText: "María Fernández" }).count()) === 1, "segmento «Aceptan promociones»");

console.log("Cajero · permisos");
await login(page, "cajero", "Cajero1234!");
await page.goto(`${BASE}/clientes?q=esquina`);
await page.getByRole("link", { name: "Tienda La Esquina" }).click();
await page.waitForURL(/\/clientes\/[0-9a-f-]{36}$/);
check((await page.locator("text=Condiciones de crédito").count()) === 0, "el cajero no puede cambiar el crédito");

await browser.close();
if (failures.length) {
  console.log(`\n✘ ${failures.length} verificación(es) fallaron`);
  process.exit(1);
}
console.log("\n✔ Clientes, crédito y pagos divididos: todo en orden");
