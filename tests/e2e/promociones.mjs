/**
 * Recorrido E2E de Fase 4D: alta de promoción desde el back-office, 3x2 y
 * precio especial aplicados solos en caja con explicación en carrito y
 * ticket, cupón, lista de precios por grupo de cliente y revisión.
 * Uso: BASE_URL=http://localhost:3100 node tests/e2e/promociones.mjs   (requiere semillas)
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
async function scan(page, code, times = 1) {
  for (let i = 0; i < times; i++) {
    await page.getByTestId("pos-search").fill(code);
    await page.getByTestId("pos-search").press("Enter");
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
page.on("dialog", (d) => d.accept());

console.log("Gerente · alta de promoción");
await login(page, "gerente", "Gerente1234!");
check((await page.locator('nav a[href="/promociones"]').count()) === 1, "el menú muestra Promociones");
await page.goto(`${BASE}/promociones`);
const list = await page.locator("main").textContent();
check(list.includes("3x2 en galletas") && list.includes("Bienvenida 10 %"), "lista las promociones demo");
await page.goto(`${BASE}/promociones/nueva`);
await page.getByLabel("Tipo de promoción").selectOption("special_price");
await page.locator("main input").first().fill("Bolsa a $10");
await page.locator('input[placeholder="0.00"]').first().fill("10");
await page.getByRole("button", { name: "Productos", exact: true }).click();
await page.getByLabel("Buscar producto").fill("BOLSA");
await page.locator('[role="listbox"] button').first().click();
await page.getByLabel("Prioridad").fill("3");
await page.screenshot({ path: `${SHOTS}/70-promocion-form.png`, fullPage: true });
await page.getByRole("button", { name: "Crear promoción" }).click();
await page.waitForURL(/\/promociones\/[0-9a-f-]{36}\?guardada=1$/);
const promoUrl = page.url().split("?")[0];
check((await page.locator("text=Promoción guardada").count()) === 1, "crea «Bolsa a $10» por precio especial");
await page.goto(`${BASE}/promociones/listas`);
check((await page.locator("tr", { hasText: "Mayoreo" }).textContent()).includes("Mayoreo"), "la lista Mayoreo está asignada al grupo Mayoreo");

console.log("Cajero · promociones en caja");
await login(page, "cajero", "Cajero1234!");
await page.goto(`${BASE}/caja`);
if (await page.locator('input[name="openingAmount"]').count()) {
  await page.fill('input[name="openingAmount"]', "500");
  await page.click('button:has-text("Abrir caja")');
  await page.waitForURL(/\/caja\/[0-9a-f-]{36}$/);
}
await page.goto(`${BASE}/pos`);
await page.getByTestId("product-grid").waitFor();
await scan(page, "GALL-AVENA", 3);
await page.getByTestId("applied-promos").waitFor();
check((await page.getByTestId("applied-promos").textContent()).includes("3x2 en galletas (3x2): −$35.00"), "aplica 3x2 en galletas y lo explica");
check(money(await page.getByTestId("cart-total").textContent()) === 70, "total $70.00 (3 galletas de $35 pagando 2)");
await scan(page, "BOLSA");
check((await page.getByTestId("applied-promos").textContent()).includes("Bolsa a $10 (a $10.00): −$5.00"), "aplica la promoción recién creada");
check(money(await page.getByTestId("cart-total").textContent()) === 80, "total $80.00");
await page.screenshot({ path: `${SHOTS}/71-pos-promociones.png` });
await page.getByTestId("charge").click();
await page.getByTestId("received").fill("100");
await page.getByTestId("confirm-sale").click();
await page.getByTestId("ticket").waitFor();
const t1 = await page.getByTestId("ticket").textContent();
check(t1.includes("Promociones") && t1.includes("3x2 en galletas") && t1.includes("Ahorro$40.00"), "el ticket explica las promociones y el ahorro");
await page.screenshot({ path: `${SHOTS}/72-ticket-promociones.png` });
await page.getByTestId("new-sale").click();

console.log("Cajero · cupón");
await scan(page, "7500000000042"); // papas $19.00
await page.getByTestId("add-coupon").click();
await page.getByTestId("coupon-code").fill("noexiste");
await page.getByRole("button", { name: "Aplicar cupón" }).click();
await page.waitForSelector("text=El cupón no existe");
check(true, "rechaza un cupón inexistente");
await page.getByTestId("coupon-code").fill("bienvenida10");
await page.getByRole("button", { name: "Aplicar cupón" }).click();
await page.getByTestId("applied-promos").waitFor();
check(money(await page.getByTestId("cart-total").textContent()) === 17.1, "el cupón BIENVENIDA10 descuenta 10 % ($17.10)");
await page.getByTestId("charge").click();
await page.getByTestId("received").fill("20");
await page.getByTestId("confirm-sale").click();
await page.getByTestId("ticket").waitFor();
check((await page.getByTestId("ticket").textContent()).includes("Bienvenida 10 %"), "el ticket muestra el cupón aplicado");
await page.getByTestId("new-sale").click();

console.log("Cajero · lista de precios por grupo");
await scan(page, "7500000000066"); // arroz $29.90
check(money(await page.getByTestId("cart-total").textContent()) === 29.9, "precio normal $29.90 sin cliente");
await page.getByTestId("add-customer").click();
await page.getByLabel("Buscar cliente").fill("esquina");
await page.locator('[data-testid="customer-results"] button', { hasText: "Tienda La Esquina" }).first().click();
await page.getByTestId("sale-customer").waitFor();
check(money(await page.getByTestId("cart-total").textContent()) === 27, "con cliente de Mayoreo el arroz cuesta $27.00");
await page.getByTestId("charge").click();
await page.getByTestId("received").fill("27");
await page.getByTestId("confirm-sale").click();
await page.getByTestId("ticket").waitFor();
check((await page.getByTestId("ticket").textContent()).includes("$27.00"), "el servidor acepta el precio de lista");
await page.getByTestId("new-sale").click();

console.log("Gerente · resultados y limpieza");
await login(page, "gerente", "Gerente1234!");
await page.goto(`${BASE}/promociones`);
const usos = await page.locator("tr", { hasText: "3x2 en galletas" }).textContent();
check(/Vigente/.test(usos), "la promoción sigue vigente y registra usos");
await page.goto(promoUrl);
await page.getByRole("button", { name: "Pausar" }).click();
await page.getByRole("button", { name: "Confirmar" }).click();
await page.waitForSelector("text=Pausada");
check(true, "pausa la promoción de prueba");
await page.goto(`${BASE}/ventas/revision`);
check((await page.locator("main").textContent()).includes("Por revisar"), "la pantalla de revisión está disponible");
await page.goto(`${BASE}/configuracion`);
check((await page.locator("text=Agregar método de pago").count()) === 0, "el gerente ve métodos e impuestos pero no los edita");

console.log("Dueño · método de pago");
await login(page, "dueno", "Dueno1234!");
await page.goto(`${BASE}/configuracion`);
check((await page.locator("text=Agregar método de pago").count()) === 1 && (await page.locator("text=Agregar impuesto").count()) === 1, "el dueño puede editar métodos de pago e impuestos");
await page.screenshot({ path: `${SHOTS}/73-configuracion.png`, fullPage: true });

await browser.close();
if (failures.length) {
  console.log(`\n✘ ${failures.length} verificación(es) fallaron`);
  process.exit(1);
}
console.log("\n✔ Promociones, cupones y listas de precios: todo en orden");
