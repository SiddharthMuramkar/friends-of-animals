CREATE TYPE "public"."ledger_account_kind" AS ENUM('asset', 'liability', 'equity', 'income', 'expense');--> statement-breakpoint
CREATE TABLE "ledger_account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "ledger_account_kind" NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"public_label" text,
	"public_group" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ledger_account_code_key" UNIQUE("code"),
	CONSTRAINT "ledger_account_code_matches_kind" CHECK ("ledger_account"."code" ~ '^[0-9]{4}$' AND left("ledger_account"."code", 1) = CASE "ledger_account"."kind" WHEN 'asset' THEN '1' WHEN 'liability' THEN '2' WHEN 'equity' THEN '3' WHEN 'income' THEN '4' WHEN 'expense' THEN '5' END),
	CONSTRAINT "ledger_account_public_group_for_categories" CHECK (("ledger_account"."kind" IN ('income', 'expense')) = ("ledger_account"."public_group" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ledger_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"posting_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"account_id" uuid NOT NULL,
	"debit_minor" bigint NOT NULL,
	"credit_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"memo" text,
	CONSTRAINT "ledger_line_posting_id_line_no_key" UNIQUE("posting_id","line_no"),
	CONSTRAINT "ledger_line_line_no_positive" CHECK ("ledger_line"."line_no" >= 1),
	CONSTRAINT "ledger_line_one_side" CHECK (("ledger_line"."debit_minor" > 0 AND "ledger_line"."credit_minor" = 0) OR ("ledger_line"."credit_minor" > 0 AND "ledger_line"."debit_minor" = 0)),
	CONSTRAINT "ledger_line_currency_inr" CHECK ("ledger_line"."currency" = 'INR'),
	CONSTRAINT "ledger_line_memo_length" CHECK (char_length("ledger_line"."memo") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "ledger_posting" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "ledger_posting_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"period_month" text NOT NULL,
	"description" text NOT NULL,
	"expected_line_count" smallint NOT NULL,
	"competition_id" uuid,
	"reversal_of_posting_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ledger_posting_seq_key" UNIQUE("seq"),
	CONSTRAINT "ledger_posting_source_key" UNIQUE("source_type","source_id"),
	CONSTRAINT "ledger_posting_period_month_format" CHECK ("ledger_posting"."period_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "ledger_posting_description_length" CHECK (char_length("ledger_posting"."description") BETWEEN 1 AND 500),
	CONSTRAINT "ledger_posting_minimum_line_count" CHECK ("ledger_posting"."expected_line_count" >= 2)
);
--> statement-breakpoint
ALTER TABLE "ledger_line" ADD CONSTRAINT "ledger_line_posting_id_ledger_posting_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."ledger_posting"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_line" ADD CONSTRAINT "ledger_line_account_id_ledger_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_posting" ADD CONSTRAINT "ledger_posting_reversal_of_posting_id_ledger_posting_id_fk" FOREIGN KEY ("reversal_of_posting_id") REFERENCES "public"."ledger_posting"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_line_account_id_idx" ON "ledger_line" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ledger_posting_occurred_at_idx" ON "ledger_posting" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "ledger_posting_reversal_of_posting_id_idx" ON "ledger_posting" USING btree ("reversal_of_posting_id");