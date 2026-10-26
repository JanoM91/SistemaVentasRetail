/**
 * Recorrido extremo a extremo con Playwright contra un servidor en marcha.
 * Uso: BASE_URL=http://localhost:3100 node tests/e2e/smoke.mjs
 * Requiere las semillas (npm run db:seed). Guarda capturas en tests/e2e/shots/.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOTS = "tests/e2e/shots";
fs.mkdirSync(SHOTS, { recursive: true });

const failures = [];
function check(cond, msg) {
  if (cond) console.log("  ✔", msg);
  else {
    console.log("  ✘", msg);
    failures.push(msg);
  }
}

async function login(page, username, password) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState("networkidle");
}

const browser = await chromium.launch();
const stamp = Date.now().toString(36);

// ---------- Dueño ----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  console.log("Dueño");
  await login(page, "dueno", "Dueno1234!");
  check(page.url() === `${BASE}/`, "entra al inicio tras iniciar sesión");
  await page.screenshot({ path: `${SHOTS}/01-inicio-dueno.png`, fullPage: true });
  check(await page.locator("nav a").count() >= 7, "la navegación muestra los módulos del dueño");

  await page.goto(`${BASE}/sucursales`);
  check((await page.locator("table tbody tr").count()) >= 2, "lista sucursales de la empresa demo");
  await page.screenshot({ path: `${SHOTS}/02-sucursales.png`, fullPage: true });

  // Crear sucursal
  await page.goto(`${BASE}/sucursales/nueva`);
  await page.fill('input[name="code"]', `E2E${stamp}`.toUpperCase().slice(0, 12));
  await page.fill('input[name="name"]', `Sucursal E2E ${stamp}`);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/sucursales\/[0-9a-f-]{36}$/);
  check(true, "crea una sucursal y redirige a su detalle");
  check((await page.locator("text=Almacén principal").count()) >= 1, "la sucursal nueva trae almacén principal");
  await page.screenshot({ path: `${SHOTS}/03-sucursal-detalle.png`, fullPage: true });

  // Validación de formulario
  await page.goto(`${BASE}/sucursales/nueva`);
  await page.fill('input[name="code"]', "con espacio");
  await page.fill('input[name="name"]', "x");
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=Revisa los campos marcados");
  check(true, "muestra errores de validación por campo");

  // Crear usuario con contraseña temporal
  await page.goto(`${BASE}/usuarios/nuevo`);
  await page.fill('input[name="fullName"]', "Usuario E2E");
  await page.fill('input[name="username"]', `e2e.${stamp}`);
  const roleOptions = await page.locator('select[name="roleId"] option').allTextContents();
  check(roleOptions.some((o) => o.startsWith("Cajero")), "ofrece el rol Cajero");
  await page.selectOption('select[name="roleId"]', { label: roleOptions.find((o) => o.startsWith("Cajero")) });
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=Contraseña temporal");
  const temp = (await page.locator("code.font-mono").first().textContent())?.trim();
  check(!!temp && temp.length >= 12, "muestra la contraseña temporal una sola vez");
  await page.screenshot({ path: `${SHOTS}/04-usuario-creado.png`, fullPage: true });

  // Configuración: módulos
  await page.goto(`${BASE}/configuracion`);
  await page.screenshot({ path: `${SHOTS}/05-configuracion.png`, fullPage: true });
  check((await page.locator("text=Módulos activos").count()) === 1, "muestra configuración de módulos");

  // Bitácora
  await page.goto(`${BASE}/bitacora`);
  check((await page.locator("table tbody tr").count()) >= 3, "la bitácora registra las acciones anteriores");
  check((await page.locator("text=branches.create").count()) >= 1, "incluye la creación de sucursal");
  await page.screenshot({ path: `${SHOTS}/06-bitacora.png`, fullPage: true });

  // Roles: sistema solo lectura
  await page.goto(`${BASE}/roles`);
  await page.click("text=Cajero");
  await page.waitForSelector("text=solo lectura");
  check(true, "los roles del sistema son solo lectura");

  // Plataforma denegada
  await page.goto(`${BASE}/plataforma`);
  await page.waitForURL(/sin-permiso/);
  check(true, "el dueño no entra a Plataforma");

  // Modo oscuro
  await page.goto(`${BASE}/`);
  await page.click('button[title="Cambiar tema"]');
  check((await page.getAttribute("html", "data-theme")) === "dark", "cambia a modo oscuro");
  await page.screenshot({ path: `${SHOTS}/07-oscuro.png`, fullPage: true });

  // Nuevo usuario inicia sesión con temporal y debe cambiarla
  await page.context().clearCookies();
  await login(page, `e2e.${stamp}`, temp);
  check(page.url().includes("/cambiar-contrasena"), "la contraseña temporal obliga a cambiarla");
  await page.goto(`${BASE}/usuarios`);
  check(page.url().includes("/cambiar-contrasena"), "no puede navegar hasta cambiarla");
  await page.fill('input[name="currentPassword"]', temp);
  await page.fill('input[name="newPassword"]', "Nueva12345");
  await page.fill('input[name="confirmPassword"]', "Nueva12345");
  await page.click('button[type="submit"]');
  await page.waitForURL(/login/);
  check(true, "tras cambiarla se cierra la sesión");
  await page.close();
}

// ---------- Cajero ----------
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  console.log("Cajero (móvil)");
  await login(page, "cajero", "Cajero1234!");
  check(page.url() === `${BASE}/`, "entra al inicio");
  await page.screenshot({ path: `${SHOTS}/08-cajero-movil.png`, fullPage: true });
  await page.click('button[aria-label="Abrir menú"]');
  const links = await page.locator("nav a").allTextContents();
  check(!links.includes("Usuarios") && !links.includes("Configuración"), "la navegación oculta lo que no puede usar");
  await page.goto(`${BASE}/usuarios`);
  await page.waitForURL(/sin-permiso/);
  check(true, "acceso directo a /usuarios denegado");
  await page.close();
}

// ---------- Superadministrador ----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  console.log("Superadministrador");
  await login(page, "superadmin", "Admin1234!");
  await page.goto(`${BASE}/plataforma`);
  check((await page.locator("table tbody tr").count()) >= 2, "lista las cuentas");
  await page.goto(`${BASE}/plataforma/nueva`);
  await page.fill('input[name="name"]', `Cuenta E2E ${stamp}`);
  await page.fill('input[name="slug"]', `e2e-${stamp}`);
  await page.fill('input[name="companyTradeName"]', "Tienda E2E");
  await page.fill('input[name="ownerFullName"]', "Dueño E2E");
  await page.fill('input[name="ownerUsername"]', `dueno.${stamp}`);
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=Contraseña temporal");
  check(true, "crea una cuenta con dueño y contraseña temporal");
  await page.screenshot({ path: `${SHOTS}/09-plataforma-cuenta.png`, fullPage: true });
  await page.close();
}

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} comprobaciones fallaron`);
  process.exit(1);
}
console.log("\nRecorrido E2E completo sin fallos.");
