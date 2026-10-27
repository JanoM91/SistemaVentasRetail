import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "@/lib/pos/local-db";
import { db } from "@/server/db";
import { companyModules, customerCreditMovements, customers, MODULE_KEYS, paymentMethods, taxProfiles, unitsOfMeasure } from "@/server/db/schema";
import { ConflictError, DomainError, ForbiddenError, ValidationError } from "@/server/errors";
import { createProduct } from "@/server/modules/catalog/service";
import { computeSummary, openSession } from "@/server/modules/cash/service";
import { cancelSale, createSale } from "@/server/modules/sales/service";
import {
  adjustCredit,
  computeAging,
  createCustomer,
  getCustomerProfile,
  listCustomers,
  listReceivables,
  registerCustomerPayment,
  saveGroup,
  searchCustomersForPos,
  setCreditTerms,
  updateCustomer,
} from "@/server/modules/customers/service";
import { contextFor, createTenantFixture, PASSWORD, resetDatabase, type Fixture } from "../helpers";

type Ctx = Awaited<ReturnType<typeof contextFor>>;

describe("Fase 4B · antigüedad de saldos", () => {
  it("aplica abonos a los cargos más antiguos y clasifica lo vencido", () => {
    const a = computeAging(
      [
        { amount: 10000, dueDate: "2026-08-01", createdAt: "2026-07-01T10:00:00Z" },
        { amount: 5000, dueDate: "2026-10-10", createdAt: "2026-09-10T10:00:00Z" },
        { amount: 3000, dueDate: "2026-11-15", createdAt: "2026-10-15T10:00:00Z" },
        { amount: -12000, dueDate: null, createdAt: "2026-10-20T10:00:00Z" },
      ],
      "2026-10-27",
    );
    // El abono liquida el cargo de julio (100) y 20 del de septiembre.
    expect(a.d1_30).toBe(3000); // 30 restantes del cargo vencido el 10-oct (17 días)
    expect(a.current).toBe(3000);
    expect(a.overdue).toBe(3000);
    expect(a.balance).toBe(6000);
    expect(a.oldestDueDate).toBe("2026-10-10");
  });

  it("clasifica por tramos y conserva saldo a favor", () => {
    const a = computeAging(
      [
        { amount: 1000, dueDate: "2026-06-01", createdAt: "2026-05-01T00:00:00Z" },
        { amount: 2000, dueDate: "2026-08-20", createdAt: "2026-07-20T00:00:00Z" },
        { amount: 4000, dueDate: "2026-09-15", createdAt: "2026-08-15T00:00:00Z" },
      ],
      "2026-10-27",
    );
    expect(a.d90).toBe(1000);
    expect(a.d61_90).toBe(2000);
    expect(a.d31_60).toBe(4000);
    const f = computeAging([{ amount: -500, dueDate: null, createdAt: "2026-10-01T00:00:00Z" }, { amount: 300, dueDate: "2026-11-01", createdAt: "2026-10-02T00:00:00Z" }], "2026-10-27");
    expect(f.credit).toBe(200);
    expect(f.balance).toBe(-200);
  });
});

describe("Fase 4B · clientes, crédito y pagos divididos", () => {
  let f: Fixture;
  let owner: Ctx;
  let manager: Ctx;
  let cashier: Ctx;
  let coca: { id: string };
  let methods: Record<string, string>;
  const auth = (u: { username: string }) => ({ username: u.username, password: PASSWORD });

  const sale = (ctx: Ctx, opts: { customerId?: string; payments: Array<{ code: string; amount: number; received?: number; reference?: string }>; qty?: number; creditAuthorization?: { username: string; password: string }; offline?: boolean; id?: string }) =>
    createSale(
      ctx,
      {
        id: opts.id ?? uuidv7(),
        cashRegisterId: f.register.id,
        customerId: opts.customerId,
        lines: [{ variantId: coca.id, quantity: opts.qty ?? 10, unitPrice: 1850, discount: 0 }],
        payments: opts.payments.map((p) => ({ paymentMethodId: methods[p.code], amount: p.amount, received: p.received, reference: p.reference })),
        creditAuthorization: opts.creditAuthorization,
      },
      { origin: opts.offline ? "offline" : "online" },
    );

  beforeEach(async () => {
    await resetDatabase();
    f = await createTenantFixture();
    for (const m of MODULE_KEYS) {
      await db.insert(companyModules).values({ companyId: f.company.id, module: m, enabled: true }).onConflictDoUpdate({ target: [companyModules.companyId, companyModules.module], set: { enabled: true } });
    }
    owner = await contextFor(f.owner);
    manager = await contextFor(f.manager);
    cashier = await contextFor(f.cashier);
    const [iva] = await db.select().from(taxProfiles).where(and(eq(taxProfiles.companyId, f.company.id), eq(taxProfiles.code, "IVA16")));
    const [pza] = await db.select().from(unitsOfMeasure).where(and(eq(unitsOfMeasure.companyId, f.company.id), eq(unitsOfMeasure.code, "PZA")));
    coca = (await createProduct(owner, { name: "Coca", sku: "COCA", kind: "simple", unitId: pza.id, taxProfileId: iva.id, variants: [{ sku: "COCA", price: "18.50", cost: "10", initialStock: 200 }] })).variants[0];
    const pm = await db.select().from(paymentMethods).where(eq(paymentMethods.companyId, f.company.id));
    methods = Object.fromEntries(pm.map((m) => [m.code, m.id]));
    await openSession(cashier, { cashRegisterId: f.register.id, openingAmount: "500" });
  });

  it("alta de clientes: folio, duplicados, RFC, grupos, búsqueda y segmentos", async () => {
    const g = await saveGroup(manager, null, { name: "Mayoreo" });
    const ana = await createCustomer(cashier, { name: "Ana López", phone: "228 123 4567", email: "Ana@Correo.mx", groupId: g.id, marketingConsent: "on" });
    expect(ana.code).toBe("CL-000001");
    expect(ana.email).toBe("ana@correo.mx");
    expect(ana.marketingConsentAt).not.toBeNull();
    await expect(createCustomer(cashier, { name: "Ana L.", phone: "2281234567" })).rejects.toMatchObject({ code: "duplicate_customer" });
    await expect(createCustomer(cashier, { name: "Mal RFC", taxId: "ABC123" })).rejects.toThrow(ValidationError);
    await expect(createCustomer(cashier, { name: "Tel corto", phone: "12345" })).rejects.toThrow(ValidationError);
    const beto = await createCustomer(cashier, { name: "Beto Ruiz", taxId: "ruab800101abc" });
    expect(beto.taxId).toBe("RUAB800101ABC");
    expect((await listCustomers(cashier, { q: "4567" })).map((r) => r.c.name)).toEqual(["Ana López"]);
    expect((await listCustomers(cashier, { segment: "marketing" })).length).toBe(1);
    expect((await listCustomers(cashier, { segment: "sin_compras" })).length).toBe(2);
    await sale(cashier, { customerId: ana.id, payments: [{ code: "EFECTIVO", amount: 18500 }] });
    expect((await listCustomers(cashier, { segment: "nuevos" })).map((r) => r.c.name)).toEqual(["Ana López"]);
    const upd = await updateCustomer(cashier, ana.id, { name: "Ana López Pérez", phone: "2281234567", marketingConsent: "" });
    expect(upd.marketingConsent).toBe(false);
    expect(upd.marketingConsentAt).toBeNull();
    expect((await searchCustomersForPos(cashier, "lópez"))[0].credit).toBeNull();
  });

  it("pago dividido: efectivo + tarjeta; el corte solo cuenta el efectivo", async () => {
    const r = await sale(cashier, { payments: [{ code: "TDD", amount: 10000, reference: "A1" }, { code: "EFECTIVO", amount: 8500, received: 10000 }] });
    expect(r.sale.total).toBe(18500);
    expect(r.sale.changeAmount).toBe(1500);
    await expect(sale(cashier, { payments: [{ code: "TDD", amount: 10000, reference: "A2" }, { code: "EFECTIVO", amount: 5000 }] })).rejects.toMatchObject({ code: "payment_mismatch" });
    const [s] = await db.select().from((await import("@/server/db/schema")).cashSessions);
    const sum = await computeSummary(db, s);
    expect(sum.byMethod.map((m) => [m.kind, m.amount]).sort()).toEqual([["card_debit", 10000], ["cash", 8500]]);
    expect(sum.expectedCash).toBe(50000 + 8500);
  });

  it("venta a crédito: requiere cliente con crédito, permiso y autorización fuera de límite", async () => {
    const c = await createCustomer(cashier, { name: "Tienda Don Pepe", phone: "2289990000" });
    await expect(sale(manager, { customerId: c.id, payments: [{ code: "CREDITO", amount: 18500 }] })).rejects.toThrow(/no tiene crédito/);
    await expect(setCreditTerms(cashier, c.id, { enabled: "on", creditLimit: "500", creditDays: 15 })).rejects.toThrow(ForbiddenError);
    await setCreditTerms(manager, c.id, { enabled: "on", creditLimit: "500", creditDays: 15 });
    await expect(sale(manager, { payments: [{ code: "CREDITO", amount: 18500 }] })).rejects.toThrow(/elige un cliente/);
    // El cajero no tiene pos.credit_sale: requiere autorización.
    await expect(sale(cashier, { customerId: c.id, payments: [{ code: "CREDITO", amount: 18500 }] })).rejects.toMatchObject({ code: "credit_authorization_required" });
    await expect(sale(cashier, { customerId: c.id, payments: [{ code: "CREDITO", amount: 18500 }], creditAuthorization: { username: f.cashier.username, password: PASSWORD } })).rejects.toMatchObject({ code: "authorizer_forbidden" });
    const r1 = await sale(cashier, { customerId: c.id, payments: [{ code: "CREDITO", amount: 18500 }], creditAuthorization: auth(f.manager) });
    expect(r1.sale.customerName).toBe("Tienda Don Pepe");
    const [charge] = await db.select().from(customerCreditMovements).where(eq(customerCreditMovements.saleId, r1.sale.id));
    expect(charge).toMatchObject({ kind: "charge", amount: 18500, balanceAfter: 18500, authorizedBy: f.manager.id });
    expect(charge.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Pago mixto: 100 en efectivo + 85 a crédito (gerente, dentro del límite, sin autorización).
    await sale(manager, { customerId: c.id, payments: [{ code: "EFECTIVO", amount: 10000 }, { code: "CREDITO", amount: 8500 }] });
    let [row] = await db.select().from(customers).where(eq(customers.id, c.id));
    expect(row.creditBalance).toBe(27000);
    expect(row.purchasesCount).toBe(2);
    expect(row.purchasesTotal).toBe(37000);
    // 270 + 370 > 500: fuera de límite.
    await expect(sale(manager, { customerId: c.id, qty: 20, payments: [{ code: "CREDITO", amount: 37000 }] })).rejects.toThrow(/excede el crédito disponible \(230.00\)/);
    await sale(manager, { customerId: c.id, qty: 20, payments: [{ code: "CREDITO", amount: 37000 }], creditAuthorization: auth(f.owner) });
    [row] = await db.select().from(customers).where(eq(customers.id, c.id));
    expect(row.creditBalance).toBe(64000);
    // Bloqueado: no se puede ni con autorización.
    await setCreditTerms(manager, c.id, { enabled: "on", creditLimit: "1000", creditDays: 15, creditBlocked: "on" });
    await expect(sale(manager, { customerId: c.id, payments: [{ code: "CREDITO", amount: 18500 }], creditAuthorization: auth(f.owner) })).rejects.toThrow(/bloqueado/);
  });

  it("crédito con cargos vencidos requiere autorización; sin módulo Crédito no se vende a crédito", async () => {
    const c = await createCustomer(cashier, { name: "Moroso" });
    await setCreditTerms(manager, c.id, { enabled: "on", creditLimit: "2000", creditDays: 30 });
    await db.insert(customerCreditMovements).values({ tenantId: f.tenant.id, companyId: f.company.id, customerId: c.id, kind: "adjustment", amount: 10000, balanceAfter: 10000, dueDate: "2026-01-31", notes: "saldo inicial", createdBy: f.owner.id });
    await db.update(customers).set({ creditBalance: 10000 }).where(eq(customers.id, c.id));
    await expect(sale(manager, { customerId: c.id, payments: [{ code: "CREDITO", amount: 18500 }] })).rejects.toThrow(/tiene 100.00 vencido/);
    await sale(manager, { customerId: c.id, payments: [{ code: "CREDITO", amount: 18500 }], creditAuthorization: auth(f.manager) });
    const rec = await listReceivables(manager);
    expect(rec.list[0].aging.d90).toBe(10000);
    expect(rec.list[0].aging.current).toBe(18500);
    expect((await listCustomers(manager, { segment: "vencidos" })).length).toBe(1);
    await db.update(companyModules).set({ enabled: false }).where(and(eq(companyModules.companyId, f.company.id), eq(companyModules.module, "credit")));
    const noCredit = await contextFor(f.manager);
    await expect(sale(noCredit, { customerId: c.id, payments: [{ code: "CREDITO", amount: 18500 }], creditAuthorization: auth(f.owner) })).rejects.toThrow(/módulo Crédito/);
  });

  it("abonos en caja entran al corte; fuera de caja no aceptan efectivo; reenvío idempotente", async () => {
    const c = await createCustomer(cashier, { name: "Cliente Abonos" });
    await setCreditTerms(manager, c.id, { enabled: "on", creditLimit: "1000", creditDays: 30 });
    await sale(manager, { customerId: c.id, qty: 20, payments: [{ code: "CREDITO", amount: 37000 }] });
    const id = uuidv7();
    const a1 = await registerCustomerPayment(cashier, { id, customerId: c.id, amount: "100", paymentMethodId: methods.EFECTIVO, cashRegisterId: f.register.id });
    expect(a1.movement.folio).toBe("AB-000001");
    expect(a1.movement.balanceAfter).toBe(27000);
    const again = await registerCustomerPayment(cashier, { id, customerId: c.id, amount: "100", paymentMethodId: methods.EFECTIVO, cashRegisterId: f.register.id });
    expect(again.duplicate).toBe(true);
    await expect(registerCustomerPayment(cashier, { customerId: c.id, amount: "500", paymentMethodId: methods.EFECTIVO, cashRegisterId: f.register.id })).rejects.toThrow(/excede el saldo \(270.00\)/);
    await expect(registerCustomerPayment(cashier, { customerId: c.id, amount: "50", paymentMethodId: methods.TRANSFER, reference: "X" })).rejects.toThrow(ForbiddenError);
    await expect(registerCustomerPayment(owner, { customerId: c.id, amount: "50", paymentMethodId: methods.EFECTIVO })).rejects.toThrow(/punto de venta/);
    await expect(registerCustomerPayment(owner, { customerId: c.id, amount: "50", paymentMethodId: methods.CREDITO })).rejects.toThrow(ValidationError);
    const t = await registerCustomerPayment(owner, { customerId: c.id, amount: "70", paymentMethodId: methods.TRANSFER, reference: "SPEI123" });
    expect(t.movement.cashSessionId).toBeNull();
    const [s] = await db.select().from((await import("@/server/db/schema")).cashSessions);
    const sum = await computeSummary(db, s);
    expect(sum.cashCreditPayments).toBe(10000);
    expect(sum.expectedCash).toBe(50000 + 10000);
    const [row] = await db.select().from(customers).where(eq(customers.id, c.id));
    expect(row.creditBalance).toBe(20000);
    // Ajuste a favor (condonación) con motivo.
    await expect(adjustCredit(manager, { customerId: c.id, direction: "credit", amount: "300", reason: "Condonación" })).rejects.toThrow(/no puede exceder/);
    const adj = await adjustCredit(manager, { customerId: c.id, direction: "credit", amount: "50", reason: "Redondeo acordado" });
    expect(adj.balanceAfter).toBe(15000);
    // El estado de cuenta es inmutable.
    await expect(db.update(customerCreditMovements).set({ amount: 1 }).where(eq(customerCreditMovements.id, adj.id))).rejects.toMatchObject({ cause: { code: "P0001" } });
  });

  it("cancelar una venta a crédito reversa el cargo y las estadísticas; historial del cliente", async () => {
    const c = await createCustomer(cashier, { name: "Cancela" });
    await setCreditTerms(manager, c.id, { enabled: "on", creditLimit: "1000", creditDays: 30 });
    const r = await sale(manager, { customerId: c.id, payments: [{ code: "CREDITO", amount: 18500 }] });
    await sale(manager, { customerId: c.id, qty: 2, payments: [{ code: "EFECTIVO", amount: 3700 }] });
    await cancelSale(manager, r.sale.id, { reason: "Error de captura" });
    const [row] = await db.select().from(customers).where(eq(customers.id, c.id));
    expect(row.creditBalance).toBe(0);
    expect(row.purchasesCount).toBe(1);
    expect(row.purchasesTotal).toBe(3700);
    const p = await getCustomerProfile(manager, c.id);
    expect(p.recentSales.length).toBe(2);
    expect(p.topProducts[0]).toMatchObject({ sku: "COCA", times: 1 });
    expect(p.movements.map((m) => m.m.kind)).toEqual(["reversal", "charge"]);
    expect(p.aging?.balance).toBe(0);
  });

  it("offline: no acepta crédito; un cliente inexistente se marca y la venta entra", async () => {
    const c = await createCustomer(cashier, { name: "Off" });
    await setCreditTerms(manager, c.id, { enabled: "on", creditLimit: "1000", creditDays: 30 });
    await expect(sale(cashier, { customerId: c.id, offline: true, payments: [{ code: "CREDITO", amount: 18500 }] })).rejects.toMatchObject({ code: "offline_non_cash" });
    const r = await sale(cashier, { customerId: "0191a1b2-0000-7000-8000-000000000000", offline: true, payments: [{ code: "EFECTIVO", amount: 18500 }] });
    expect(r.flags.map((x) => x.code)).toContain("customer_missing");
    expect(r.sale.customerId).toBeNull();
    const ok = await sale(cashier, { customerId: c.id, offline: true, payments: [{ code: "EFECTIVO", amount: 18500 }] });
    expect(ok.sale.customerId).toBe(c.id);
  });

  it("errores de dominio esperados son DomainError/ConflictError", () => {
    expect(new ConflictError("x")).toBeInstanceOf(DomainError);
  });
});
