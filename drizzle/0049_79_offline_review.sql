CREATE TYPE "public"."offline_payment_method" AS ENUM('cheque', 'bank_transfer', 'cash');--> statement-breakpoint
CREATE TYPE "public"."payment_capture_method" AS ENUM('gateway', 'offline');--> statement-breakpoint
CREATE TYPE "public"."payment_review_outcome" AS ENUM('confirm', 'refund', 'keep');--> statement-breakpoint
CREATE TYPE "public"."payment_review_reason" AS ENUM('already_paid', 'registration_cancelled', 'amount_mismatch', 'registration_closed', 'batch_superseded');--> statement-breakpoint
CREATE TABLE "offline_payment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"method" "offline_payment_method" NOT NULL,
	"reference" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"received_on" date NOT NULL,
	"proof_file_asset_id" uuid NOT NULL,
	"recorded_by_user_id" uuid,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "offline_payment_batch_unique" UNIQUE("batch_id"),
	CONSTRAINT "offline_payment_amount_positive" CHECK ("offline_payment"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_review_case" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"reason" "payment_review_reason" NOT NULL,
	"gateway_payment_id" text,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"batch_status_before" "payment_batch_status" NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" uuid,
	"outcome" "payment_review_outcome",
	"resolution_reason" text,
	"refund_due" boolean DEFAULT false NOT NULL,
	CONSTRAINT "payment_review_case_payment_unique" UNIQUE("batch_id","gateway_payment_id"),
	CONSTRAINT "payment_review_case_resolved_together" CHECK (("payment_review_case"."resolved_at" IS NULL) = ("payment_review_case"."outcome" IS NULL) AND ("payment_review_case"."outcome" IS NULL) = ("payment_review_case"."resolution_reason" IS NULL)),
	CONSTRAINT "payment_review_case_refund_only_on_refund" CHECK (NOT "payment_review_case"."refund_due" OR "payment_review_case"."outcome" = 'refund')
);
--> statement-breakpoint
ALTER TABLE "payment_batch" DROP CONSTRAINT "payment_batch_order_when_opened";--> statement-breakpoint
ALTER TABLE "payment_batch" DROP CONSTRAINT "payment_batch_payment_when_captured";--> statement-breakpoint
ALTER TABLE "payment_batch" ADD COLUMN "capture_method" "payment_capture_method";--> statement-breakpoint
ALTER TABLE "offline_payment" ADD CONSTRAINT "offline_payment_batch_id_payment_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payment_batch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_payment" ADD CONSTRAINT "offline_payment_proof_file_asset_id_file_asset_id_fk" FOREIGN KEY ("proof_file_asset_id") REFERENCES "public"."file_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_payment" ADD CONSTRAINT "offline_payment_recorded_by_user_id_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_review_case" ADD CONSTRAINT "payment_review_case_batch_id_payment_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payment_batch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_review_case" ADD CONSTRAINT "payment_review_case_resolved_by_user_id_user_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offline_payment_proof_file_asset_id_idx" ON "offline_payment" USING btree ("proof_file_asset_id");--> statement-breakpoint
CREATE INDEX "offline_payment_recorded_by_user_id_idx" ON "offline_payment" USING btree ("recorded_by_user_id");--> statement-breakpoint
CREATE INDEX "payment_review_case_batch_id_idx" ON "payment_review_case" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "payment_review_case_opened_at_idx" ON "payment_review_case" USING btree ("opened_at");--> statement-breakpoint
CREATE INDEX "payment_review_case_resolved_by_user_id_idx" ON "payment_review_case" USING btree ("resolved_by_user_id");--> statement-breakpoint
ALTER TABLE "payment_batch" ADD CONSTRAINT "payment_batch_order_when_opened" CHECK ("payment_batch"."gateway_order_id" IS NOT NULL OR "payment_batch"."status" NOT IN ('order_created', 'captured') OR ("payment_batch"."status" = 'captured' AND "payment_batch"."capture_method" = 'offline'));--> statement-breakpoint
ALTER TABLE "payment_batch" ADD CONSTRAINT "payment_batch_payment_when_captured" CHECK ("payment_batch"."status" <> 'captured' OR ("payment_batch"."captured_at" IS NOT NULL AND ("payment_batch"."gateway_payment_id" IS NOT NULL OR "payment_batch"."capture_method" = 'offline')));