CREATE TABLE "customer_credit_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"branch_id" uuid,
	"kind" text NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"folio" text,
	"sale_id" uuid,
	"payment_method_id" uuid,
	"payment_kind" text,
	"cash_session_id" uuid,
	"reference" text,
	"due_date" date,
	"notes" text,
	"created_by" uuid NOT NULL,
	"authorized_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deactivated_at" timestamp with time zone,
	"deactivated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"birthday" date,
	"group_id" uuid,
	"tax_id" text,
	"legal_name" text,
	"tax_regime" text,
	"cfdi_use" text,
	"tax_postal_code" text,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"marketing_consent_at" timestamp with time zone,
	"credit_limit" bigint,
	"credit_days" integer DEFAULT 30 NOT NULL,
	"credit_blocked" boolean DEFAULT false NOT NULL,
	"credit_balance" bigint DEFAULT 0 NOT NULL,
	"purchases_count" integer DEFAULT 0 NOT NULL,
	"purchases_total" bigint DEFAULT 0 NOT NULL,
	"first_purchase_at" timestamp with time zone,
	"last_purchase_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deactivated_at" timestamp with time zone,
	"deactivated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_credit_movements" ADD CONSTRAINT "customer_credit_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_movements" ADD CONSTRAINT "customer_credit_movements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_movements" ADD CONSTRAINT "customer_credit_movements_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_movements" ADD CONSTRAINT "customer_credit_movements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_movements" ADD CONSTRAINT "customer_credit_movements_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_movements" ADD CONSTRAINT "customer_credit_movements_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_movements" ADD CONSTRAINT "customer_credit_movements_cash_session_id_cash_sessions_id_fk" FOREIGN KEY ("cash_session_id") REFERENCES "public"."cash_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_movements" ADD CONSTRAINT "customer_credit_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_movements" ADD CONSTRAINT "customer_credit_movements_authorized_by_users_id_fk" FOREIGN KEY ("authorized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_groups" ADD CONSTRAINT "customer_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_groups" ADD CONSTRAINT "customer_groups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_group_id_customer_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."customer_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_mov_customer_idx" ON "customer_credit_movements" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_mov_session_idx" ON "customer_credit_movements" USING btree ("cash_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_mov_sale_kind_idx" ON "customer_credit_movements" USING btree ("sale_id","kind") WHERE "customer_credit_movements"."sale_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_groups_name_idx" ON "customer_groups" USING btree ("company_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "customers_code_idx" ON "customers" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "customers_phone_idx" ON "customers" USING btree ("company_id","phone");--> statement-breakpoint
CREATE INDEX "customers_name_idx" ON "customers" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "customers_balance_idx" ON "customers" USING btree ("company_id") WHERE "customers"."credit_balance" <> 0;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_customer_idx" ON "sales" USING btree ("customer_id","sold_at");--> statement-breakpoint
-- Estado de cuenta de clientes inmutable (misma regla que el libro de inventario).
CREATE TRIGGER customer_credit_movements_immutable
  BEFORE UPDATE OR DELETE ON customer_credit_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
-- Búsqueda de clientes por nombre en el POS.
CREATE INDEX IF NOT EXISTS customers_name_trgm_idx ON customers USING gin (lower(name) gin_trgm_ops);
--> statement-breakpoint
-- Método de pago "Crédito del cliente" para empresas ya existentes.
INSERT INTO payment_methods (tenant_id, company_id, code, name, kind, requires_reference, opens_drawer, allows_change, is_active, sort_order)
SELECT c.tenant_id, c.id, 'CREDITO', 'Crédito del cliente', 'customer_credit', false, false, false, true, 9
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM payment_methods pm WHERE pm.company_id = c.id AND pm.code = 'CREDITO');
