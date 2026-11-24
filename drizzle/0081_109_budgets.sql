CREATE TABLE "ledger_budget" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"period_month" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ledger_budget_account_month_key" UNIQUE("account_id","period_month"),
	CONSTRAINT "ledger_budget_period_month_format" CHECK ("ledger_budget"."period_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "ledger_budget_amount_range" CHECK ("ledger_budget"."amount_minor" BETWEEN 0 AND 1000000000000)
);
--> statement-breakpoint
ALTER TABLE "ledger_budget" ADD CONSTRAINT "ledger_budget_account_id_ledger_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_budget_period_month_idx" ON "ledger_budget" USING btree ("period_month");