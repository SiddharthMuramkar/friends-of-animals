CREATE TYPE "public"."refund_kind" AS ENUM('discretionary', 'cancellation', 'duplicate');--> statement-breakpoint
CREATE TYPE "public"."refund_manual_method" AS ENUM('cheque', 'bank_transfer', 'cash');--> statement-breakpoint
CREATE TYPE "public"."refund_method" AS ENUM('gateway', 'manual');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('requested', 'approved', 'rejected', 'processing', 'refunded', 'failed');--> statement-breakpoint
CREATE TABLE "gateway_test_refund" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_id" text NOT NULL,
	"status" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"notes" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gateway_test_refund_idempotency_key" UNIQUE("idempotency_key"),
	CONSTRAINT "gateway_test_refund_amount_positive" CHECK ("gateway_test_refund"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "refund" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"review_case_id" uuid,
	"gateway_payment_id" text,
	"kind" "refund_kind" NOT NULL,
	"status" "refund_status" NOT NULL,
	"method" "refund_method" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"reason" text NOT NULL,
	"requested_by" uuid,
	"requested_at" timestamp with time zone NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"idempotency_key" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"gateway_refund_id" text,
	"manual_method" "refund_manual_method",
	"manual_reference" text,
	"manual_recorded_by" uuid,
	"sent_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "refund_idempotency_key" UNIQUE("idempotency_key"),
	CONSTRAINT "refund_gateway_refund_id" UNIQUE("gateway_refund_id"),
	CONSTRAINT "refund_amount_positive" CHECK ("refund"."amount_minor" > 0),
	CONSTRAINT "refund_currency_inr" CHECK ("refund"."currency" = 'INR'),
	CONSTRAINT "refund_attempt_positive" CHECK ("refund"."attempt" >= 1),
	CONSTRAINT "refund_reason_present" CHECK (length(trim("refund"."reason")) > 0),
	CONSTRAINT "refund_decider_not_requester" CHECK ("refund"."requested_by" IS NULL OR "refund"."decided_by" IS NULL OR "refund"."requested_by" <> "refund"."decided_by"),
	CONSTRAINT "refund_gateway_has_payment" CHECK ("refund"."method" <> 'gateway' OR "refund"."gateway_payment_id" IS NOT NULL),
	CONSTRAINT "refund_manual_recorded_when_refunded" CHECK ("refund"."method" <> 'manual' OR "refund"."status" <> 'refunded' OR ("refund"."manual_method" IS NOT NULL AND "refund"."manual_reference" IS NOT NULL)),
	CONSTRAINT "refund_manual_has_no_gateway_refund" CHECK ("refund"."method" <> 'manual' OR "refund"."gateway_refund_id" IS NULL),
	CONSTRAINT "refund_failed_at_when_failed" CHECK ("refund"."status" <> 'failed' OR "refund"."failed_at" IS NOT NULL),
	CONSTRAINT "refund_refunded_at_when_refunded" CHECK (("refund"."status" = 'refunded') = ("refund"."refunded_at" IS NOT NULL)),
	CONSTRAINT "refund_case_only_for_duplicates" CHECK (("refund"."kind" = 'duplicate') = ("refund"."review_case_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "refund_item" (
	"refund_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "refund_item_refund_id_registration_id_pk" PRIMARY KEY("refund_id","registration_id"),
	CONSTRAINT "refund_item_amount_positive" CHECK ("refund_item"."amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "gateway_test_refund" ADD CONSTRAINT "gateway_test_refund_payment_id_gateway_test_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."gateway_test_payment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_batch_id_payment_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payment_batch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_review_case_id_payment_review_case_id_fk" FOREIGN KEY ("review_case_id") REFERENCES "public"."payment_review_case"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_manual_recorded_by_user_id_fk" FOREIGN KEY ("manual_recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_item" ADD CONSTRAINT "refund_item_refund_id_refund_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refund"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_item" ADD CONSTRAINT "refund_item_registration_id_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registration"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_item" ADD CONSTRAINT "refund_item_batch_item_fk" FOREIGN KEY ("batch_id","registration_id") REFERENCES "public"."payment_batch_item"("batch_id","registration_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gateway_test_refund_payment_id_idx" ON "gateway_test_refund" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "refund_batch_id_idx" ON "refund" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "refund_status_requested_at_idx" ON "refund" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "refund_requested_at_idx" ON "refund" USING btree ("requested_at");--> statement-breakpoint
CREATE INDEX "refund_gateway_payment_id_idx" ON "refund" USING btree ("gateway_payment_id");--> statement-breakpoint
CREATE INDEX "refund_review_case_id_idx" ON "refund" USING btree ("review_case_id");--> statement-breakpoint
CREATE INDEX "refund_requested_by_idx" ON "refund" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "refund_decided_by_idx" ON "refund" USING btree ("decided_by");--> statement-breakpoint
CREATE INDEX "refund_manual_recorded_by_idx" ON "refund" USING btree ("manual_recorded_by");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_item_live_registration_unique" ON "refund_item" USING btree ("registration_id") WHERE "refund_item"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "refund_item_batch_id_registration_id_idx" ON "refund_item" USING btree ("batch_id","registration_id");