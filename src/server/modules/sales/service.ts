import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/server/db";
import {
  branches,
  cashRegisters,
  cashSessions,
  companies,
  customerCreditMovements,
  customerGroups,
  customers,
  promotionRedemptions,
  inventoryLedger,
  saleReturns,
  paymentMethods,
  payments,
  products,
  productVariants,
  saleLines,
  sales,
  taxProfiles,
  unitsOfMeasure,
  users,
  type SaleFlag,
} from "@/server/db/schema";
import { recordAudit } from "@/server/audit";
import { hasPermission, requirePermission } from "@/server/authz/guard";
import { ConflictError, DomainError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { requireCompany, type ServiceContext } from "@/server/service-context";
import { parseOrThrow } from "@/server/validation";
import { computeLine, computeTotals, normalizeQty, roundHalfEven } from "@/lib/money";
import { postMovement } from "@/server/modules/inventory/ledger";
import { allowsNegative, getDefaultWarehouse, variantLabel } from "@/server/modules/inventory/service";
import { getAccessibleRegister, getOpenSession } from "@/server/modules/cash/service";
import { bumpPurchaseStats, checkCreditSale, postCreditCharge, reverseCreditCharge } from "@/server/modules/customers/service";
import { getStoreCredit, redeemStoreCredits, reverseRedemptions } from "@/server/modules/returns/service";
import { activeRules, exhaustedPromotionIds, priceListRules, recordRedemptions, reverseRedemptionsForSale, validateCoupon } from "@/server/modules/promotions/service";
import { evaluatePromotions, listPrice } from "@/lib/promotions";
import { verifyAuthorizer } from "@/server/modules/auth/service";
import { nextFolio } from "@/server/modules/sequences";

// ---------------------------------------------------------------- Entrada

export const saleInputSchema = z.object({
  /** UUID generado por el POS; garantiza que la misma venta no se registre dos veces. */
  id: z.string().uuid(),
  cashRegisterId: z.string().uuid(),
  soldAt: z.string().datetime({ offset: true }).optional(),
  clientSequence: z.number().int().nonnegative().optional(),
  deviceId: z.string().max(64).optional(),
  customerName: z.string().trim().max(120).optional().or(z.literal("")),
  /** Cliente registrado (opcional; obligatorio para pagar a crédito). */
  customerId: z.string().uuid().optional().nullable(),
  /** Autorización de gerente para vender a crédito fuera de límite o sin permiso. */
  creditAuthorization: z.object({ username: z.string(), password: z.string() }).optional(),
  /** Cupones capturados (requieren conexión). */
  couponCodes: z.array(z.string().trim().max(30)).max(3).optional(),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  lines: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        quantity: z.number().positive().max(100_000),
        unitPrice: z.number().int().nonnegative(),
        discount: z.number().int().nonnegative().default(0),
        /** Descuento por promociones calculado por el POS (el servidor lo recalcula y compara). */
        promoDiscount: z.number().int().nonnegative().default(0),
      }),
    )
    .min(1, "La venta no tiene productos")
    .max(500),
  payments: z
    .array(
      z.object({
        paymentMethodId: z.string().uuid(),
        amount: z.number().int().positive(),
        received: z.number().int().nonnegative().optional(),
        reference: z.string().trim().max(80).optional(),
      }),
    )
    .min(1, "Falta el pago")
    .max(10),
  discountAuthorization: z.object({ username: z.string(), password: z.string() }).optional(),
});
export type SaleInput = z.infer<typeof saleInputSchema>;

export type CreateSaleResult =
  | { status: "applied"; sale: typeof sales.$inferSelect; flags: SaleFlag[] }
  | { status: "duplicate"; sale: typeof sales.$inferSelect; flags: SaleFlag[] };

// ---------------------------------------------------------------- Folios

// ---------------------------------------------------------------- Alta de venta

function isUniqueViolation(err: unknown, constraint?: string) {
  const e = ((err as { cause?: unknown })?.cause ?? err) as { code?: string; constraint?: string };
  return e?.code === "23505" && (!constraint || e.constraint === constraint);
}

/**
 * Registra una venta. La misma función atiende al POS en línea y a la
 * sincronización de ventas hechas sin internet:
 *
 * - En línea las reglas son estrictas (precio vigente, existencia, turno
 *   abierto, descuentos autorizados); si algo falla, la venta no se registra.
 * - Offline la venta ya se cobró: se acepta y lo anómalo se marca en `flags`
 *   para revisión (precio cambiado, inventario negativo, turno cerrado…).
 *   Solo se rechaza lo que no se puede registrar (producto o caja inexistente,
 *   pagos que no cuadran).
 */
export async function createSale(ctx: ServiceContext, raw: unknown, opts: { origin: "online" | "offline" }): Promise<CreateSaleResult> {
  requirePermission(ctx, "pos.sell");
  const company = requireCompany(ctx);
  const input = parseOrThrow(saleInputSchema, raw);
  const offline = opts.origin === "offline";

  const existing = await findExisting(input.id, ctx.tenantId);
  if (existing) return { status: "duplicate", sale: existing, flags: existing.flags };

  const reg = await getAccessibleRegister(ctx, input.cashRegisterId);
  const warehouse = await getDefaultWarehouse(db, reg.branchId);
  const soldAt = input.soldAt ? new Date(input.soldAt) : new Date();
  const flags: SaleFlag[] = [];
  const flag = (code: SaleFlag["code"], detail: string) => {
    if (!flags.some((f) => f.code === code && f.detail === detail)) flags.push({ code, detail });
  };

  // --- Turno de caja
  let session = await getOpenSession(db, reg.id);
  if (offline && (!session || session.openedAt > new Date(soldAt.getTime() + 5 * 60_000))) {
    const [prior] = await db
      .select()
      .from(cashSessions)
      .where(and(eq(cashSessions.cashRegisterId, reg.id), lte(cashSessions.openedAt, new Date(soldAt.getTime() + 5 * 60_000))))
      .orderBy(desc(cashSessions.openedAt))
      .limit(1);
    session = prior ?? session;
    if (session && session.status === "closed") flag("session_closed", `El turno abierto el ${session.openedAt.toISOString()} ya estaba cerrado al sincronizar.`);
  }
  if (!session) throw new ConflictError(`${reg.name} no tiene un turno abierto. Abre la caja antes de vender.`);
  if (offline && Date.now() - soldAt.getTime() > 72 * 3600_000) flag("late_sync", "La venta se sincronizó más de 72 h después de realizarse.");

  // --- Cliente: lista de precios y promociones de su grupo
  let customer: typeof customers.$inferSelect | null = null;
  if (input.customerId) {
    [customer] = await db.select().from(customers).where(and(eq(customers.id, input.customerId), eq(customers.companyId, company.id))).limit(1);
    if (!customer) {
      if (offline) flag("customer_missing", "El cliente de la venta ya no existe; se registró sin cliente.");
      else throw new NotFoundError("El cliente");
      customer = null;
    }
  }
  const [group] = customer?.groupId ? await db.select().from(customerGroups).where(eq(customerGroups.id, customer.groupId)).limit(1) : [];
  const priceList = group?.priceListId ? ((await priceListRules(db, company.id)).find((l) => l.id === group.priceListId) ?? null) : null;

  // --- Productos
  const variantIds = [...new Set(input.lines.map((l) => l.variantId))];
  const rows = await db
    .select({ v: productVariants, p: products, tax: taxProfiles, unit: unitsOfMeasure })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(taxProfiles, eq(taxProfiles.id, products.taxProfileId))
    .innerJoin(unitsOfMeasure, eq(unitsOfMeasure.id, products.unitId))
    .where(and(inArray(productVariants.id, variantIds), eq(productVariants.companyId, company.id)));
  const byId = new Map(rows.map((r) => [r.v.id, r]));
  const missing = variantIds.filter((id) => !byId.has(id));
  if (missing.length) throw new DomainError("unknown_product", "La venta incluye productos que no existen en el catálogo.", 422);

  const canEditPrice = hasPermission(ctx, "pos.edit_price");
  const canDiscount = hasPermission(ctx, "pos.discount");
  const maxPct = company.settings?.promotions?.maxDiscountPercent ?? 100;
  const anyDiscount = input.lines.some((l) => l.discount > 0);
  let discountAuthorizedBy: string | null = null;
  if (anyDiscount && !canDiscount) {
    if (offline) flag("discount_unauthorized", "Descuento aplicado sin permiso pos.discount.");
    else if (!input.discountAuthorization) throw new ForbiddenError("pos.discount", "El descuento requiere autorización de un gerente.");
    else discountAuthorizedBy = (await verifyAuthorizer({ tenantId: ctx.tenantId, companyId: company.id, ...input.discountAuthorization, permission: "pos.discount" })).authorizerId;
  }

  const computed = input.lines.map((l, i) => {
    const r = byId.get(l.variantId)!;
    const label = variantLabel(r.p, r.v);
    const quantity = normalizeQty(l.quantity);
    if (!r.unit.allowsDecimals && !Number.isInteger(quantity)) {
      throw new ValidationError({ [`lines.${i}.quantity`]: [`${label} se vende por ${r.unit.name.toLowerCase()} entera.`] }, `${label} se vende por ${r.unit.name.toLowerCase()} entera.`);
    }
    if (r.v.deactivatedAt || r.p.deactivatedAt) {
      if (offline) flag("variant_inactive", `${label} estaba desactivado al sincronizar.`);
      else throw new ConflictError(`${label} ya no está activo. Actualiza el catálogo del punto de venta.`);
    }
    const expected = listPrice(priceList, r.v.id, r.v.price);
    if (l.unitPrice !== expected && !canEditPrice) {
      if (offline) flag("price_changed", `${label}: cobrado ${l.unitPrice}, catálogo ${expected}.`);
      else throw new DomainError("price_changed", `El precio de ${label} cambió. Actualiza el catálogo del punto de venta.`, 409);
    }
    const gross = computeLine({ unitPrice: l.unitPrice, quantity, discount: 0, taxRate: Number(r.tax.rate), taxIncluded: r.tax.isIncludedInPrice }).gross;
    if (l.discount > 0 && gross > 0 && (l.discount / gross) * 100 > maxPct + 1e-9) {
      if (offline) flag("discount_unauthorized", `${label}: descuento mayor al ${maxPct} % permitido.`);
      else throw new ValidationError({ [`lines.${i}.discount`]: [`El descuento máximo permitido es ${maxPct} %.`] }, `El descuento máximo permitido es ${maxPct} %.`);
    }
    return { line: l, r, label, quantity };
  });

  // --- Promociones: el servidor recalcula con el mismo motor que el POS
  const couponInfos: Array<Awaited<ReturnType<typeof validateCoupon>>> = [];
  for (const code of [...new Set((input.couponCodes ?? []).map((c) => c.toUpperCase()).filter(Boolean))]) {
    if (offline) {
      flag("promotion_mismatch", `El cupón ${code} no se puede validar en una venta sin conexión.`);
      continue;
    }
    couponInfos.push(await validateCoupon(ctx, code));
  }
  const { rows: promoRows, rules } = ctx.enabledModules.has("promotions") ? await activeRules(db, company.id) : { rows: [], rules: [] };
  const promo = evaluatePromotions(
    computed.map((c, i) => ({ key: String(i), variantId: c.r.v.id, productId: c.r.p.id, categoryId: c.r.p.categoryId, quantity: c.quantity, unitPrice: c.line.unitPrice, manualDiscount: c.line.discount, allowsDecimals: c.r.unit.allowsDecimals })),
    rules,
    {
      now: soldAt,
      timezone: company.timezone,
      branchId: reg.branchId,
      customerGroupId: customer?.groupId ?? null,
      couponPromotionIds: couponInfos.map((c) => c.promotionId),
      exhaustedPromotionIds: offline ? [] : await exhaustedPromotionIds(db, promoRows, customer?.id),
      allowStacking: company.settings?.promotions?.allowStacking ?? false,
    },
  );
  const promoMatches = computed.every((c, i) => (promo.lineDiscounts[String(i)] ?? 0) === c.line.promoDiscount);
  if (!promoMatches) {
    if (!offline) throw new DomainError("promotions_changed", "Las promociones cambiaron desde que se cargó el punto de venta. Se actualizaron; revisa el total y cobra de nuevo.", 409);
    flag("promotion_mismatch", `Promociones del POS (${computed.reduce((a, c) => a + c.line.promoDiscount, 0)}) distintas a las vigentes (${promo.total}); se respetó lo cobrado.`);
  }
  const lines = computed.map((c, i) => {
    const promoDiscount = promoMatches ? (promo.lineDiscounts[String(i)] ?? 0) : c.line.promoDiscount;
    const amounts = computeLine({ unitPrice: c.line.unitPrice, quantity: c.quantity, discount: c.line.discount + promoDiscount, taxRate: Number(c.r.tax.rate), taxIncluded: c.r.tax.isIncludedInPrice });
    return { ...c, promoDiscount, amounts };
  });
  const totals = computeTotals(lines.map((c) => ({ unitPrice: c.line.unitPrice, quantity: c.quantity, discount: c.amounts.discount, taxRate: Number(c.r.tax.rate), taxIncluded: c.r.tax.isIncludedInPrice, amounts: c.amounts })));

  // --- Pagos
  const methodIds = [...new Set(input.payments.map((p) => p.paymentMethodId))];
  const methods = await db.select().from(paymentMethods).where(and(inArray(paymentMethods.id, methodIds), eq(paymentMethods.companyId, company.id)));
  const methodById = new Map(methods.map((m) => [m.id, m]));
  const paymentRows = input.payments.map((p, i) => {
    const m = methodById.get(p.paymentMethodId);
    if (!m || !m.isActive) throw new ValidationError({ [`payments.${i}`]: ["Método de pago no disponible."] }, "Método de pago no disponible.");
    if (offline && m.kind !== "cash") throw new DomainError("offline_non_cash", "Sin conexión solo se aceptan pagos en efectivo.", 422);
    if (m.kind === "cash" || m.allowsChange) {
      const received = p.received ?? p.amount;
      if (received < p.amount) throw new ValidationError({ [`payments.${i}.received`]: ["El efectivo recibido es menor al importe."] }, "El efectivo recibido es menor al importe.");
      return { m, amount: p.amount, received, change: received - p.amount, reference: p.reference || null };
    }
    if (m.kind === "prepaid") {
      if (!p.reference) throw new ValidationError({ [`payments.${i}.reference`]: ["Captura el folio del vale."] }, "Captura el folio del vale.");
      return { m, amount: p.amount, received: null, change: 0, reference: p.reference.trim().toUpperCase() };
    }
    if (m.requiresReference && !p.reference) throw new ValidationError({ [`payments.${i}.reference`]: [`${m.name} requiere número de referencia o autorización.`] }, `${m.name} requiere número de referencia o autorización.`);
    return { m, amount: p.amount, received: null, change: 0, reference: p.reference || null };
  });
  const paid = paymentRows.reduce((a, p) => a + p.amount, 0);
  if (paid !== totals.total) throw new DomainError("payment_mismatch", `Los pagos (${(paid / 100).toFixed(2)}) no cuadran con el total (${(totals.total / 100).toFixed(2)}).`, 422);
  const change = paymentRows.reduce((a, p) => a + p.change, 0);

  // --- Vales de devolución
  const voucherRows = paymentRows.filter((p) => p.m.kind === "prepaid");
  for (const v of voucherRows) {
    const credit = await getStoreCredit(ctx, v.reference!).catch(() => null);
    if (!credit) throw new ValidationError({ payments: [`El vale ${v.reference} no existe.`] }, `El vale ${v.reference} no existe.`);
    if (credit.balance < v.amount) throw new ConflictError(`El vale ${credit.folio} solo tiene ${(credit.balance / 100).toFixed(2)} disponibles.`);
  }

  // --- Crédito
  const creditRows = paymentRows.filter((p) => p.m.kind === "customer_credit");
  const creditAmount = creditRows.reduce((a, p) => a + p.amount, 0);
  let creditAuthorizedBy: string | null = null;
  if (creditRows.length) {
    if (creditRows.length > 1) throw new ValidationError({ payments: ["Solo un pago a crédito por venta."] }, "Solo un pago a crédito por venta.");
    if (!customer) throw new ValidationError({ customerId: ["Elige el cliente."] }, "Para vender a crédito elige un cliente registrado.");
    creditAuthorizedBy = (await checkCreditSale(ctx, customer, creditAmount, input.creditAuthorization)).authorizedBy;
  }

  // --- Registro atómico
  try {
    return await db.transaction(async (tx) => {
      // Bloquea el turno: si se está cerrando, la venta espera y luego ve el estado real.
      const [lockedSession] = await tx.select().from(cashSessions).where(eq(cashSessions.id, session!.id)).for("update");
      if (lockedSession.status === "closed" && !offline) throw new ConflictError("El turno se cerró mientras registrabas la venta. Abre la caja de nuevo.");

      const folio = await nextFolio(tx, { tenantId: ctx.tenantId, companyId: company.id, branchId: reg.branchId, documentType: "sale" });
      const negativeOk = offline ? true : allowsNegative(ctx, warehouse);
      const lineCosts: Array<number | null> = [];
      for (const c of lines) {
        if (!c.r.p.trackStock) {
          lineCosts.push(c.r.v.cost);
          continue;
        }
        const mv = await postMovement(tx, {
          tenantId: ctx.tenantId,
          companyId: company.id,
          branchId: reg.branchId,
          warehouseId: warehouse.id,
          variantId: c.r.v.id,
          movementType: "sale_out",
          quantity: -c.quantity,
          allowNegative: negativeOk,
          referenceType: "sale",
          referenceId: input.id,
          createdBy: ctx.userId,
          label: c.label,
        });
        if (offline && mv.onHand < 0) flag("negative_stock", `${c.label} quedó con existencia ${mv.onHand}.`);
        lineCosts.push(mv.unitCost ?? c.r.v.cost);
      }
      const costTotal = lineCosts.every((x) => x !== null)
        ? lines.reduce((a, c, i) => a + roundHalfEven((lineCosts[i] as number) * c.quantity), 0)
        : null;

      const [sale] = await tx
        .insert(sales)
        .values({
          id: input.id,
          tenantId: ctx.tenantId,
          companyId: company.id,
          branchId: reg.branchId,
          warehouseId: warehouse.id,
          cashRegisterId: reg.id,
          cashSessionId: lockedSession.id,
          series: folio.series,
          number: folio.number,
          folio: folio.folio,
          currency: company.currency,
          subtotal: totals.subtotal,
          discountTotal: totals.discount,
          taxTotal: totals.tax,
          total: totals.total,
          paidTotal: paid,
          changeAmount: change,
          costTotal,
          customerId: customer?.id ?? null,
          customerName: customer?.name ?? (input.customerName || null),
          notes: input.notes || null,
          soldBy: ctx.userId,
          soldAt,
          origin: opts.origin,
          deviceId: input.deviceId ?? ctx.actor.deviceId ?? null,
          clientSequence: input.clientSequence ?? null,
          syncedAt: offline ? new Date() : null,
          flags,
          discountAuthorizedBy,
        })
        .returning();

      await tx.insert(saleLines).values(
        lines.map((c, i) => ({
          tenantId: ctx.tenantId,
          companyId: company.id,
          saleId: sale.id,
          lineNo: i + 1,
          variantId: c.r.v.id,
          sku: c.r.v.sku,
          description: c.r.p.name + (c.r.v.variantName ? ` ${c.r.v.variantName}` : ""),
          quantity: String(c.quantity),
          unitPrice: c.line.unitPrice,
          listPrice: c.r.v.price,
          discountAmount: c.amounts.discount,
          promotionDiscount: c.promoDiscount,
          taxRate: c.r.tax.rate,
          taxIncluded: c.r.tax.isIncludedInPrice,
          taxAmount: c.amounts.tax,
          netAmount: c.amounts.net,
          lineTotal: c.amounts.total,
          unitCost: lineCosts[i],
        })),
      );
      await tx.insert(payments).values(
        paymentRows.map((p) => ({
          tenantId: ctx.tenantId,
          companyId: company.id,
          saleId: sale.id,
          paymentMethodId: p.m.id,
          kind: p.m.kind,
          amount: p.amount,
          received: p.received,
          change: p.change,
          reference: p.reference,
          provider: p.m.provider,
          createdBy: ctx.userId,
        })),
      );

      if (promoMatches && promo.applied.length) {
        const problems = await recordRedemptions(tx, ctx, { saleId: sale.id, customerId: customer?.id ?? null, applied: promo.applied, coupons: couponInfos, strict: !offline });
        if (problems.length) {
          for (const pr of problems) flag("promotion_mismatch", pr);
          await tx.update(sales).set({ flags }).where(eq(sales.id, sale.id));
        }
      }
      if (voucherRows.length) await redeemStoreCredits(tx, ctx, sale.id, voucherRows.map((v) => ({ folio: v.reference!, amount: v.amount })));
      if (customer) await bumpPurchaseStats(tx, customer.id, 1, totals.total, soldAt);
      if (creditAmount > 0 && customer) {
        const charge = await postCreditCharge(tx, ctx, { customerId: customer.id, saleId: sale.id, folio: sale.folio, branchId: reg.branchId, amount: creditAmount, soldAt, authorizedBy: creditAuthorizedBy, enforceLimit: !creditAuthorizedBy });
        await recordAudit(tx, { ...ctx.actor, branchId: reg.branchId, authorizedByUserId: creditAuthorizedBy }, {
          action: "pos.credit_sale",
          entity: "sale",
          entityId: sale.id,
          after: { folio: sale.folio, customer: customer.name, amount: creditAmount, balance: charge.balance, dueDate: charge.dueDate },
        });
      }
      if (totals.discount > 0) {
        await recordAudit(tx, { ...ctx.actor, branchId: reg.branchId, authorizedByUserId: discountAuthorizedBy }, {
          action: "pos.discount",
          entity: "sale",
          entityId: sale.id,
          after: { folio: sale.folio, discount: totals.discount, total: totals.total },
        });
      }
      const editedPrices = computed.filter((c) => c.line.unitPrice !== listPrice(priceList, c.r.v.id, c.r.v.price) && canEditPrice);
      if (editedPrices.length) {
        await recordAudit(tx, { ...ctx.actor, branchId: reg.branchId }, {
          action: "pos.edit_price",
          entity: "sale",
          entityId: sale.id,
          after: { folio: sale.folio, lines: editedPrices.map((c) => ({ sku: c.r.v.sku, listPrice: c.r.v.price, charged: c.line.unitPrice })) },
        });
      }
      return { status: "applied" as const, sale, flags };
    });
  } catch (err) {
    // Dos envíos simultáneos de la misma venta: el segundo choca con la llave primaria.
    if (isUniqueViolation(err, "sales_pkey")) {
      const dup = await findExisting(input.id, ctx.tenantId);
      if (dup) return { status: "duplicate", sale: dup, flags: dup.flags };
    }
    throw err;
  }
}

async function findExisting(id: string, tenantId: string) {
  const [row] = await db.select().from(sales).where(eq(sales.id, id)).limit(1);
  if (!row) return null;
  if (row.tenantId !== tenantId) throw new NotFoundError("La venta");
  return row;
}

// ---------------------------------------------------------------- Cancelación

export const cancelSchema = z.object({
  reason: z.string().trim().min(3, "Explica el motivo").max(300),
  authorizerUsername: z.string().optional(),
  authorizerPassword: z.string().optional(),
});

/**
 * Cancela una venta del turno abierto: regresa el inventario con movimientos
 * compensatorios (al costo original) y marca los pagos como reembolsados.
 * Ventas de turnos cerrados se corrigen con una devolución (Fase 4).
 */
export async function cancelSale(ctx: ServiceContext, saleId: string, raw: unknown) {
  const input = parseOrThrow(cancelSchema, raw);
  const company = requireCompany(ctx);
  const sale = await getSaleRow(ctx, saleId);
  if (sale.status !== "completed") throw new ConflictError("La venta ya está cancelada.");
  let authorizedBy: string | null = null;
  if (!hasPermission(ctx, "pos.cancel")) {
    if (!input.authorizerUsername || !input.authorizerPassword) throw new ForbiddenError("pos.cancel", "Cancelar requiere autorización de un gerente.");
    authorizedBy = (await verifyAuthorizer({ tenantId: ctx.tenantId, companyId: company.id, username: input.authorizerUsername, password: input.authorizerPassword, permission: "pos.cancel" })).authorizerId;
  }
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(sales).where(eq(sales.id, saleId)).for("update");
    if (locked.status !== "completed") throw new ConflictError("La venta ya está cancelada.");
    const [session] = await tx.select().from(cashSessions).where(eq(cashSessions.id, locked.cashSessionId)).for("update");
    const [hasReturn] = await tx.select({ id: saleReturns.id }).from(saleReturns).where(eq(saleReturns.saleId, saleId)).limit(1);
    if (hasReturn) throw new ConflictError("La venta tiene devoluciones registradas; ya no se puede cancelar.");
    if (session.status !== "open") throw new ConflictError("La venta pertenece a un turno cerrado. Regístrala como devolución.");
    await reverseSaleInventory(tx, ctx, locked);
    const [after] = await tx
      .update(sales)
      .set({ status: "cancelled", cancelledBy: ctx.userId, cancelAuthorizedBy: authorizedBy, cancelledAt: new Date(), cancelReason: input.reason })
      .where(eq(sales.id, saleId))
      .returning();
    await tx.update(payments).set({ status: "refunded" }).where(eq(payments.saleId, saleId));
    await reverseRedemptions(tx, saleId);
    await reverseRedemptionsForSale(tx, saleId);
    if (locked.customerId) {
      await bumpPurchaseStats(tx, locked.customerId, -1, locked.total, locked.soldAt);
      await reverseCreditCharge(tx, ctx, locked);
    }
    await recordAudit(tx, { ...ctx.actor, branchId: locked.branchId, authorizedByUserId: authorizedBy }, {
      action: "pos.cancel",
      entity: "sale",
      entityId: saleId,
      reason: input.reason,
      before: { folio: locked.folio, status: "completed", total: locked.total },
      after: { folio: after.folio, status: "cancelled" },
    });
    return after;
  });
}

async function reverseSaleInventory(tx: Tx, ctx: ServiceContext, sale: typeof sales.$inferSelect) {
  const outs = await tx
    .select()
    .from(inventoryLedger)
    .where(and(eq(inventoryLedger.referenceType, "sale"), eq(inventoryLedger.referenceId, sale.id), eq(inventoryLedger.movementType, "sale_out")));
  for (const o of outs) {
    await postMovement(tx, {
      tenantId: ctx.tenantId,
      companyId: o.companyId,
      branchId: o.branchId,
      warehouseId: o.warehouseId,
      variantId: o.variantId,
      movementType: "sale_cancel_in",
      quantity: -Number(o.quantity),
      unitCost: o.unitCost,
      allowNegative: true,
      referenceType: "sale",
      referenceId: sale.id,
      reversesId: o.id,
      reason: `Cancelación de la venta ${sale.folio}`,
      createdBy: ctx.userId,
    });
  }
}

// ---------------------------------------------------------------- Consultas

async function getSaleRow(ctx: ServiceContext, saleId: string) {
  requirePermission(ctx, "pos.sell");
  const company = requireCompany(ctx);
  const [sale] = await db.select().from(sales).where(and(eq(sales.id, saleId), eq(sales.companyId, company.id))).limit(1);
  if (!sale) throw new NotFoundError("La venta");
  if (!ctx.permissions.has("branches.manage") && !ctx.branches.some((b) => b.id === sale.branchId)) throw new NotFoundError("La venta");
  return sale;
}

export async function getSale(ctx: ServiceContext, saleId: string) {
  const sale = await getSaleRow(ctx, saleId);
  const [lines, pays, meta, charge, rets, promos] = await Promise.all([
    db.select().from(saleLines).where(eq(saleLines.saleId, saleId)).orderBy(saleLines.lineNo),
    db
      .select({ p: payments, methodName: paymentMethods.name })
      .from(payments)
      .innerJoin(paymentMethods, eq(paymentMethods.id, payments.paymentMethodId))
      .where(eq(payments.saleId, saleId)),
    db
      .select({ company: companies, branch: branches, registerName: cashRegisters.name, sellerName: users.fullName })
      .from(sales)
      .innerJoin(companies, eq(companies.id, sales.companyId))
      .innerJoin(branches, eq(branches.id, sales.branchId))
      .innerJoin(cashRegisters, eq(cashRegisters.id, sales.cashRegisterId))
      .innerJoin(users, eq(users.id, sales.soldBy))
      .where(eq(sales.id, saleId))
      .limit(1),
    sale.customerId
      ? db.select().from(customerCreditMovements).where(and(eq(customerCreditMovements.saleId, saleId), eq(customerCreditMovements.kind, "charge"))).limit(1).then((r) => r[0] ?? null)
      : Promise.resolve(null),
    db.select({ id: saleReturns.id, folio: saleReturns.folio, total: saleReturns.total, refundMethod: saleReturns.refundMethod, createdAt: saleReturns.createdAt }).from(saleReturns).where(eq(saleReturns.saleId, saleId)).orderBy(saleReturns.createdAt),
    db.select({ promotionId: promotionRedemptions.promotionId, amount: promotionRedemptions.amount, description: promotionRedemptions.description, status: promotionRedemptions.status }).from(promotionRedemptions).where(eq(promotionRedemptions.saleId, saleId)),
  ]);
  const showCost = hasPermission(ctx, "reports.view_profit");
  return {
    sale: { ...sale, costTotal: showCost ? sale.costTotal : null },
    lines: lines.map((l) => ({ ...l, unitCost: showCost ? l.unitCost : null })),
    payments: pays,
    company: meta[0].company,
    branch: meta[0].branch,
    registerName: meta[0].registerName,
    sellerName: meta[0].sellerName,
    credit: charge ? { amount: charge.amount, balance: charge.balanceAfter, dueDate: charge.dueDate } : null,
    returns: rets,
    promotions: promos,
    showCost,
  };
}

export async function listSales(
  ctx: ServiceContext,
  opts: { from?: Date | null; to?: Date | null; sessionId?: string | null; status?: "completed" | "cancelled" | null; flagged?: boolean; q?: string | null; limit?: number; offset?: number } = {},
) {
  requirePermission(ctx, "pos.sell");
  const company = requireCompany(ctx);
  const where: SQL[] = [eq(sales.companyId, company.id)];
  if (!ctx.permissions.has("branches.manage")) where.push(inArray(sales.branchId, ctx.branches.map((b) => b.id).concat(["00000000-0000-0000-0000-000000000000"])));
  if (ctx.branch && !opts.sessionId) where.push(eq(sales.branchId, ctx.branch.id));
  if (opts.from) where.push(gte(sales.soldAt, opts.from));
  if (opts.to) where.push(lte(sales.soldAt, opts.to));
  if (opts.sessionId) where.push(eq(sales.cashSessionId, opts.sessionId));
  if (opts.status) where.push(eq(sales.status, opts.status));
  if (opts.flagged) where.push(sql`jsonb_array_length(${sales.flags}) > 0`);
  if (opts.q?.trim()) where.push(sql`(${sales.folio} ilike ${"%" + opts.q.trim() + "%"} or ${sales.customerName} ilike ${"%" + opts.q.trim() + "%"})`);
  const limit = Math.min(opts.limit ?? 50, 200);
  const rows = await db
    .select({ sale: sales, sellerName: users.fullName, registerName: cashRegisters.name })
    .from(sales)
    .innerJoin(users, eq(users.id, sales.soldBy))
    .innerJoin(cashRegisters, eq(cashRegisters.id, sales.cashRegisterId))
    .where(and(...where))
    .orderBy(desc(sales.soldAt))
    .limit(limit + 1)
    .offset(opts.offset ?? 0);
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}
