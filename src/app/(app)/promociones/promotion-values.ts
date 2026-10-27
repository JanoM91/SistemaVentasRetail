import type { PromotionKind } from "@/lib/promotions";

export type PromotionFormValues = {
  name: string;
  description: string;
  kind: PromotionKind;
  percent: string;
  amount: string;
  buyQty: string;
  payQty: string;
  tiers: Array<{ minQty: string; percent: string }>;
  bundle: Array<{ variantId: string; label: string; qty: string }>;
  bundlePrice: string;
  scope: "all" | "categories" | "products";
  categoryIds: string[];
  products: Array<{ id: string; name: string }>;
  startsAt: string;
  endsAt: string;
  daysOfWeek: number[];
  timeFrom: string;
  timeTo: string;
  branchIds: string[];
  customerGroupIds: string[];
  requiresCoupon: boolean;
  minPurchase: string;
  maxUses: string;
  maxUsesPerCustomer: string;
  priority: string;
  stackable: boolean;
};

export const EMPTY_PROMOTION: PromotionFormValues = {
  name: "",
  description: "",
  kind: "percent",
  percent: "",
  amount: "",
  buyQty: "2",
  payQty: "1",
  tiers: [{ minQty: "6", percent: "5" }],
  bundle: [],
  bundlePrice: "",
  scope: "all",
  categoryIds: [],
  products: [],
  startsAt: "",
  endsAt: "",
  daysOfWeek: [],
  timeFrom: "",
  timeTo: "",
  branchIds: [],
  customerGroupIds: [],
  requiresCoupon: false,
  minPurchase: "",
  maxUses: "",
  maxUsesPerCustomer: "",
  priority: "0",
  stackable: false,
};

