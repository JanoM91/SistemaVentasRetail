/**
 * Recorrido E2E de Fase 4C: devolución parcial en efectivo con autorización,
 * cambio de talla con vale aplicado a la nueva venta, corte de caja y
 * consulta en el back-office.
 * Uso: BASE_URL=http://localhost:3100 node tests/e2e/devoluciones.mjs   (requiere semillas)
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
async function scan(page, code) {
  await page.getByTestId("pos-search").fill(code);
  await page.getByTestId("pos-search").press("Enter");
}
async function payCash(page, received) {
  await page.getByTestId("charge").click();
  await page.getByTestId("received").fill(received);
  await page.getByTestId("confirm-sale").click();
  await page.getByTestId("ticket").waitFor();
  const folio = (await page.getByTestId("ticket").textContent()).match(/Folio: (V-\d{6})/)[1];
  await page.getByTestId("new-sale").click();
  return folio;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
page.on("dialog", (d) => d.accept());

console.log("Cajero · ventas de origen");
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
await page.goto(`${BASE}/pos`);
await page.getByTestId("product-grid").waitFor();
await scan(page, "7500000000011");
await scan(page, "7500000000011");
const saleA = await payCash(page, "50");
await scan(page, "PLAY-M-NEG");
const saleB = await payCash(page, "200");
check(/^V-\d{6}$/.test(saleA) && /^V-\d{6}$/.test(saleB), `ventas ${saleA} y ${saleB}`);

console.log("Cajero · devolución parcial en efectivo");
await page.getByTestId("return-button").click();
await page.getByTestId("return-folio").fill(saleA.toLowerCase());
await page.getByRole("button", { name: "Buscar venta" }).click();
await page.getByLabel(/Devuelve de Refresco/).fill("1");
await page.getByTestId("return-reason").fill("Venía abierto");
await page.getByRole("button", { name: "Efectivo", exact: true }).click();
check((await page.locator("text=Requiere autorización de un gerente").count()) === 1, "el reembolso en efectivo pide autorización al cajero");
check(money(await page.getByTestId("return-total").textContent()) === 18.5, "calcula $18.50 a devolver");
await page.getByLabel("Usuario autorizador").fill("gerente");
await page.getByLabel("Contraseña del autorizador").fill("Gerente1234!");
await page.screenshot({ path: `${SHOTS}/60-devolucion.png` });
await page.getByTestId("confirm-return").click();
await page.getByTestId("return-ticket").waitFor();
const rt = await page.getByTestId("return-ticket").textContent();
const returnFolio = rt.match(/Folio: (D-\d{6})/)?.[1];
check(!!returnFolio && rt.includes(`Venta original: ${saleA}`), `emite comprobante ${returnFolio} ligado a ${saleA}`);
check((await page.locator("text=Entrega $18.50 en efectivo").count()) === 1, "indica entregar $18.50 en efectivo");
await page.getByTestId("return-done").click();

console.log("Cajero · cambio de talla con vale");
await page.getByTestId("return-button").click();
await page.getByTestId("return-folio").fill(saleB);
await page.getByRole("button", { name: "Buscar venta" }).click();
await page.getByRole("dialog").getByRole("button", { name: "Todo", exact: true }).first().click();
await page.getByTestId("return-reason").fill("Le quedó chica");
await page.getByRole("combobox", { name: "Motivo" }).selectOption("wrong_item");
await page.getByRole("button", { name: "Cambio por otro producto" }).click();
check((await page.locator("text=Requiere autorización de un gerente").count()) === 0, "un cambio con ticket no requiere autorización");
await page.getByTestId("confirm-return").click();
await page.getByTestId("return-ticket").waitFor();
const vt = await page.getByTestId("return-ticket").textContent();
const voucher = vt.match(/Folio: (D-\d{6})/)?.[1];
check(vt.includes("DEVOLUCIÓN · VALE") && vt.includes("$199.00"), `emite vale ${voucher} por $199.00`);
await page.screenshot({ path: `${SHOTS}/61-vale.png` });
await page.getByRole("button", { name: "Elegir productos nuevos" }).click();
check((await page.getByTestId("exchange-banner").textContent()).includes(voucher), "la venta muestra el vale del cambio");
await scan(page, "PLAY-G-NEG");
await page.getByTestId("charge").click();
check(money(await page.getByTestId("pay-remaining").textContent()) === 20, "el vale cubre $199 y faltan $20");
await page.screenshot({ path: `${SHOTS}/62-cambio-cobro.png` });
await page.getByTestId("received").fill("20");
await page.getByTestId("confirm-sale").click();
await page.getByTestId("ticket").waitFor();
const nt = await page.getByTestId("ticket").textContent();
check(nt.includes(`Vale de devolución (${voucher})`) && nt.includes("$219.00"), "la venta nueva se paga con el vale y efectivo");
await page.getByTestId("new-sale").click();
check((await page.getByTestId("exchange-banner").count()) === 0, "al terminar se limpia el vale de la pantalla");

console.log("Cajero · corte");
await page.goto(sessionUrl);
const corte = await page.locator("main").textContent();
check(/Devoluciones \(\d+\)/.test(corte), "el corte lista las devoluciones");
check(corte.includes("− Devoluciones en efectivo"), "el efectivo devuelto se resta del esperado");
await page.screenshot({ path: `${SHOTS}/63-corte-devoluciones.png`, fullPage: true });

console.log("Gerente · consulta");
await login(page, "gerente", "Gerente1234!");
await page.goto(`${BASE}/ventas/devoluciones`);
check((await page.locator("tr", { hasText: returnFolio }).count()) === 1 && (await page.locator("tr", { hasText: voucher }).count()) === 1, "lista ambas devoluciones");
await page.getByRole("link", { name: voucher }).click();
await page.waitForURL(/\/ventas\/devoluciones\/[0-9a-f-]{36}$/);
const det = await page.locator("main").textContent();
check(det.includes("Saldo disponible: $0.00") && det.includes("Inventario"), "el vale quedó canjeado y la playera regresó al inventario");
await page.screenshot({ path: `${SHOTS}/64-detalle-vale.png`, fullPage: true });
await page.getByRole("link", { name: saleB }).click();
await page.waitForURL(/\/ventas\/[0-9a-f-]{36}$/);
const sd = await page.locator("main").textContent();
check(sd.includes("Devoluciones") && !sd.includes("Cancelar venta"), "la venta con devolución ya no se puede cancelar");

await browser.close();
if (failures.length) {
  console.log(`\n✘ ${failures.length} verificación(es) fallaron`);
  process.exit(1);
}
console.log("\n✔ Devoluciones y cambios: todo en orden");
