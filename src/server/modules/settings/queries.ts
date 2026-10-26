import { and, asc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { branches, documentSequences, paymentMethods, salesChannels, taxProfiles } from "@/server/db/schema";
import { requirePermission } from "@/server/authz/guard";
import { requireCompany, type ServiceContext } from "@/server/service-context";

export async function listTaxProfiles(ctx: ServiceContext) {
  requirePermission(ctx, "settings.view");
  const company = requireCompany(ctx);
  return db.select().from(taxProfiles).where(and(eq(taxProfiles.companyId, company.id), eq(taxProfiles.tenantId, ctx.tenantId))).orderBy(asc(taxProfiles.code));
}

export async function listPaymentMethods(ctx: ServiceContext) {
  requirePermission(ctx, "settings.view");
  const company = requireCompany(ctx);
  return db.select().from(paymentMethods).where(and(eq(paymentMethods.companyId, company.id), eq(paymentMethods.tenantId, ctx.tenantId))).orderBy(asc(paymentMethods.sortOrder));
}

export async function listSalesChannels(ctx: ServiceContext) {
  requirePermission(ctx, "settings.view");
  const company = requireCompany(ctx);
  return db.select().from(salesChannels).where(and(eq(salesChannels.companyId, company.id), eq(salesChannels.tenantId, ctx.tenantId))).orderBy(asc(salesChannels.code));
}

export async function listDocumentSequences(ctx: ServiceContext) {
  requirePermission(ctx, "settings.view");
  const company = requireCompany(ctx);
  return db
    .select({ seq: documentSequences, branchName: branches.name })
    .from(documentSequences)
    .leftJoin(branches, eq(branches.id, documentSequences.branchId))
    .where(and(eq(documentSequences.companyId, company.id), eq(documentSequences.tenantId, ctx.tenantId)))
    .orderBy(asc(branches.name), asc(documentSequences.documentType));
}
