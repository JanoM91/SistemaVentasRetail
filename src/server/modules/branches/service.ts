import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { branches, cashRegisters, warehouses } from "@/server/db/schema";
import { recordAudit } from "@/server/audit";
import { requirePermission } from "@/server/authz/guard";
import { ConflictError, NotFoundError } from "@/server/errors";
import { requireCompany, type ServiceContext } from "@/server/service-context";
import { parseOrThrow } from "@/server/validation";
import { addressSchema, codeSchema, nameSchema, TIMEZONES } from "@/server/modules/companies/validation";

export const branchSchema = z.object({
  code: codeSchema,
  name: nameSchema,
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  email: z.string().trim().email("Correo inválido").optional().or(z.literal("")),
  timezone: z.enum(TIMEZONES).optional().or(z.literal("")),
  address: addressSchema.optional(),
});
export const branchUpdateSchema = branchSchema.omit({ code: true });

export const warehouseSchema = z.object({
  branchId: z.string().uuid(),
  code: codeSchema,
  name: nameSchema,
  isDefault: z.boolean().default(false),
  allowsNegativeStock: z.boolean().default(false),
});

export const cashRegisterSchema = z.object({
  branchId: z.string().uuid(),
  code: codeSchema,
  name: nameSchema,
});

export type BranchRow = typeof branches.$inferSelect;

/** Sucursales de la empresa activa visibles para el usuario. */
export async function listBranches(ctx: ServiceContext, opts: { includeInactive?: boolean } = {}) {
  requirePermission(ctx, "branches.view");
  const company = requireCompany(ctx);
  const rows = await db
    .select()
    .from(branches)
    .where(eq(branches.companyId, company.id))
    .orderBy(asc(branches.name));
  const visible = new Set(ctx.branches.map((b) => b.id));
  const canSeeAll = ctx.permissions.has("branches.manage");
  return rows.filter((r) => (canSeeAll || visible.has(r.id)) && (opts.includeInactive || !r.deactivatedAt));
}

export async function getBranch(ctx: ServiceContext, branchId: string): Promise<BranchRow> {
  requirePermission(ctx, "branches.view");
  const company = requireCompany(ctx);
  const [row] = await db
    .select()
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.companyId, company.id), eq(branches.tenantId, ctx.tenantId)))
    .limit(1);
  if (!row) throw new NotFoundError("La sucursal");
  const canSeeAll = ctx.permissions.has("branches.manage");
  if (!canSeeAll && !ctx.branches.some((b) => b.id === branchId)) throw new NotFoundError("La sucursal");
  return row;
}

export async function createBranch(ctx: ServiceContext, raw: unknown) {
  requirePermission(ctx, "branches.manage");
  const company = requireCompany(ctx);
  const input = parseOrThrow(branchSchema, raw);
  return db.transaction(async (tx) => {
    const [branch] = await tx
      .insert(branches)
      .values({
        tenantId: ctx.tenantId,
        companyId: company.id,
        code: input.code,
        name: input.name,
        phone: input.phone || null,
        email: input.email || null,
        timezone: input.timezone || null,
        address: input.address ?? {},
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    // Toda sucursal nace con un almacén por defecto y una caja.
    await tx.insert(warehouses).values({
      tenantId: ctx.tenantId,
      companyId: company.id,
      branchId: branch.id,
      code: `${branch.code}-ALM`,
      name: "Almacén principal",
      isDefault: true,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    });
    await tx.insert(cashRegisters).values({
      tenantId: ctx.tenantId,
      companyId: company.id,
      branchId: branch.id,
      code: "CAJA1",
      name: "Caja 1",
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    });
    await recordAudit(tx, ctx.actor, {
      action: "branches.create",
      entity: "branch",
      entityId: branch.id,
      branchId: branch.id,
      after: { code: branch.code, name: branch.name },
    });
    return branch;
  });
}

export async function updateBranch(ctx: ServiceContext, branchId: string, raw: unknown) {
  requirePermission(ctx, "branches.manage");
  const input = parseOrThrow(branchUpdateSchema, raw);
  const before = await getBranch(ctx, branchId);
  return db.transaction(async (tx) => {
    const [after] = await tx
      .update(branches)
      .set({
        name: input.name,
        phone: input.phone || null,
        email: input.email || null,
        timezone: input.timezone || null,
        address: input.address ?? before.address,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(eq(branches.id, branchId))
      .returning();
    await recordAudit(tx, ctx.actor, {
      action: "branches.update",
      entity: "branch",
      entityId: branchId,
      branchId,
      before: { name: before.name, phone: before.phone, email: before.email, timezone: before.timezone, address: before.address },
      after: { name: after.name, phone: after.phone, email: after.email, timezone: after.timezone, address: after.address },
    });
    return after;
  });
}

export async function setBranchActive(ctx: ServiceContext, branchId: string, active: boolean, reason?: string) {
  requirePermission(ctx, "branches.manage");
  const before = await getBranch(ctx, branchId);
  if (!active) {
    const activeCount = (await listBranches(ctx)).length;
    if (activeCount <= 1) throw new ConflictError("No puedes desactivar la única sucursal activa.");
  }
  return db.transaction(async (tx) => {
    const [after] = await tx
      .update(branches)
      .set(
        active
          ? { deactivatedAt: null, deactivatedBy: null, updatedAt: new Date(), updatedBy: ctx.userId }
          : { deactivatedAt: new Date(), deactivatedBy: ctx.userId, updatedAt: new Date(), updatedBy: ctx.userId },
      )
      .where(eq(branches.id, branchId))
      .returning();
    await recordAudit(tx, ctx.actor, {
      action: active ? "branches.activate" : "branches.deactivate",
      entity: "branch",
      entityId: branchId,
      branchId,
      reason,
      before: { active: !before.deactivatedAt },
      after: { active: !after.deactivatedAt },
    });
    return after;
  });
}

// ---------- Almacenes ----------

export async function listWarehouses(ctx: ServiceContext, branchId?: string) {
  requirePermission(ctx, "branches.view");
  const company = requireCompany(ctx);
  const where = [eq(warehouses.companyId, company.id)];
  if (branchId) where.push(eq(warehouses.branchId, branchId));
  const rows = await db.select().from(warehouses).where(and(...where)).orderBy(asc(warehouses.name));
  const visible = new Set(ctx.branches.map((b) => b.id));
  const canSeeAll = ctx.permissions.has("branches.manage");
  return rows.filter((r) => canSeeAll || visible.has(r.branchId));
}

export async function createWarehouse(ctx: ServiceContext, raw: unknown) {
  requirePermission(ctx, "branches.manage");
  const company = requireCompany(ctx);
  const input = parseOrThrow(warehouseSchema, raw);
  await getBranch(ctx, input.branchId);
  return db.transaction(async (tx) => {
    if (input.isDefault) {
      await tx
        .update(warehouses)
        .set({ isDefault: false, updatedAt: new Date(), updatedBy: ctx.userId })
        .where(and(eq(warehouses.branchId, input.branchId), eq(warehouses.isDefault, true)));
    }
    const [row] = await tx
      .insert(warehouses)
      .values({
        tenantId: ctx.tenantId,
        companyId: company.id,
        branchId: input.branchId,
        code: input.code,
        name: input.name,
        isDefault: input.isDefault,
        allowsNegativeStock: input.allowsNegativeStock,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    await recordAudit(tx, ctx.actor, {
      action: "branches.warehouse_create",
      entity: "warehouse",
      entityId: row.id,
      branchId: input.branchId,
      after: { code: row.code, name: row.name, isDefault: row.isDefault, allowsNegativeStock: row.allowsNegativeStock },
    });
    return row;
  });
}

export async function updateWarehouse(ctx: ServiceContext, warehouseId: string, raw: unknown) {
  requirePermission(ctx, "branches.manage");
  const company = requireCompany(ctx);
  const input = parseOrThrow(warehouseSchema.omit({ branchId: true, code: true }), raw);
  const [before] = await db
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.id, warehouseId), eq(warehouses.companyId, company.id)))
    .limit(1);
  if (!before) throw new NotFoundError("El almacén");
  return db.transaction(async (tx) => {
    if (input.isDefault && !before.isDefault) {
      await tx
        .update(warehouses)
        .set({ isDefault: false, updatedAt: new Date(), updatedBy: ctx.userId })
        .where(and(eq(warehouses.branchId, before.branchId), eq(warehouses.isDefault, true)));
    }
    if (!input.isDefault && before.isDefault) {
      throw new ConflictError("Cada sucursal necesita un almacén por defecto. Marca otro como principal primero.");
    }
    const [after] = await tx
      .update(warehouses)
      .set({ name: input.name, isDefault: input.isDefault, allowsNegativeStock: input.allowsNegativeStock, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(warehouses.id, warehouseId))
      .returning();
    await recordAudit(tx, ctx.actor, {
      action: "branches.warehouse_update",
      entity: "warehouse",
      entityId: warehouseId,
      branchId: before.branchId,
      before: { name: before.name, isDefault: before.isDefault, allowsNegativeStock: before.allowsNegativeStock },
      after: { name: after.name, isDefault: after.isDefault, allowsNegativeStock: after.allowsNegativeStock },
    });
    return after;
  });
}

// ---------- Cajas ----------

export async function listCashRegisters(ctx: ServiceContext, branchId?: string) {
  requirePermission(ctx, "branches.view");
  const company = requireCompany(ctx);
  const where = [eq(cashRegisters.companyId, company.id), isNull(cashRegisters.deactivatedAt)];
  if (branchId) where.push(eq(cashRegisters.branchId, branchId));
  const rows = await db.select().from(cashRegisters).where(and(...where)).orderBy(asc(cashRegisters.name));
  const visible = new Set(ctx.branches.map((b) => b.id));
  const canSeeAll = ctx.permissions.has("branches.manage");
  return rows.filter((r) => canSeeAll || visible.has(r.branchId));
}

export async function createCashRegister(ctx: ServiceContext, raw: unknown) {
  requirePermission(ctx, "branches.manage");
  const company = requireCompany(ctx);
  const input = parseOrThrow(cashRegisterSchema, raw);
  await getBranch(ctx, input.branchId);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(cashRegisters)
      .values({
        tenantId: ctx.tenantId,
        companyId: company.id,
        branchId: input.branchId,
        code: input.code,
        name: input.name,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    await recordAudit(tx, ctx.actor, {
      action: "branches.register_create",
      entity: "cash_register",
      entityId: row.id,
      branchId: input.branchId,
      after: { code: row.code, name: row.name },
    });
    return row;
  });
}

export async function deactivateCashRegister(ctx: ServiceContext, registerId: string, reason?: string) {
  requirePermission(ctx, "branches.manage");
  const company = requireCompany(ctx);
  const [before] = await db
    .select()
    .from(cashRegisters)
    .where(and(eq(cashRegisters.id, registerId), eq(cashRegisters.companyId, company.id)))
    .limit(1);
  if (!before) throw new NotFoundError("La caja");
  return db.transaction(async (tx) => {
    await tx
      .update(cashRegisters)
      .set({ deactivatedAt: new Date(), deactivatedBy: ctx.userId, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(cashRegisters.id, registerId));
    await recordAudit(tx, ctx.actor, {
      action: "branches.register_deactivate",
      entity: "cash_register",
      entityId: registerId,
      branchId: before.branchId,
      reason,
      before: { active: true, code: before.code },
      after: { active: false, code: before.code },
    });
  });
}
