import { z } from "zod";

export const codeSchema = z
  .string()
  .trim()
  .min(1, "Obligatorio")
  .max(20, "Máximo 20 caracteres")
  .regex(/^[A-Za-z0-9_-]+$/, "Solo letras, números, guion y guion bajo")
  .transform((s) => s.toUpperCase());

export const nameSchema = z.string().trim().min(2, "Mínimo 2 caracteres").max(120, "Máximo 120 caracteres");

export const addressSchema = z.object({
  street: z.string().trim().max(120).optional().or(z.literal("")),
  exteriorNumber: z.string().trim().max(20).optional().or(z.literal("")),
  interiorNumber: z.string().trim().max(20).optional().or(z.literal("")),
  neighborhood: z.string().trim().max(80).optional().or(z.literal("")),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  state: z.string().trim().max(80).optional().or(z.literal("")),
  postalCode: z.string().trim().max(10).optional().or(z.literal("")),
  country: z.string().trim().max(2).optional().or(z.literal("")),
});

export const TIMEZONES = [
  "America/Mexico_City",
  "America/Cancun",
  "America/Chihuahua",
  "America/Hermosillo",
  "America/Tijuana",
  "America/Bogota",
  "America/Lima",
  "America/Santiago",
  "America/Argentina/Buenos_Aires",
  "America/Guatemala",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/Madrid",
] as const;

export const LOCALES = ["es-MX", "es-ES", "es-CO", "es-AR", "en-US"] as const;
export const DATE_FORMATS = ["dd/MM/yyyy", "yyyy-MM-dd", "MM/dd/yyyy"] as const;
export const CURRENCIES = ["MXN", "USD", "COP", "PEN", "CLP", "ARS", "GTQ", "EUR"] as const;

export const companySchema = z.object({
  code: codeSchema,
  legalName: nameSchema,
  tradeName: nameSchema,
  taxId: z.string().trim().max(20).optional().or(z.literal("")),
  taxRegime: z.string().trim().max(10).optional().or(z.literal("")),
  currency: z.enum(CURRENCIES),
  timezone: z.enum(TIMEZONES),
  locale: z.enum(LOCALES),
  dateFormat: z.enum(DATE_FORMATS),
  address: addressSchema.optional(),
});
export type CompanyInput = z.infer<typeof companySchema>;

export const companyUpdateSchema = companySchema.omit({ code: true });
export type CompanyUpdateInput = z.infer<typeof companyUpdateSchema>;

export const companySettingsSchema = z.object({
  inventory: z.object({
    costingMethod: z.enum(["average", "fifo", "manual"]).default("average"),
    allowNegativeStock: z.boolean().default(false),
  }),
  promotions: z.object({
    allowStacking: z.boolean().default(false),
    maxDiscountPercent: z.coerce.number().min(0).max(100).default(100),
  }),
  pos: z.object({
    allowSaleWithoutCustomer: z.boolean().default(true),
    requireCustomerForCredit: z.boolean().default(true),
  }),
  notifications: z.object({
    lowStockEmail: z.string().trim().email("Correo inválido").optional().or(z.literal("")).nullable(),
  }),
});
export type CompanySettingsInput = z.infer<typeof companySettingsSchema>;
