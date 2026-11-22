CREATE TYPE "public"."payment_batch_status" AS ENUM('created', 'order_created', 'captured', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "gateway_webhook_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"gateway" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"order_id" text,
	"outcome" text,
	"received_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "gateway_webhook_event_unique" UNIQUE("gateway","event_id"),
	CONSTRAINT "gateway_webhook_event_outcome_when_processed" CHECK (("gateway_webhook_event"."outcome" IS NULL) = ("gateway_webhook_event"."processed_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "payment_batch" (
	"id" uuid PRIMARY KEY NOT NULL,
	"route" "participation_route" NOT NULL,
	"competition_id" uuid NOT NULL,
	"institution_id" uuid,
	"institution_registration_id" uuid,
	"payer_user_id" uuid,
	"status" "payment_batch_status" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"gateway" text NOT NULL,
	"gateway_order_id" text,
	"gateway_payment_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"captured_at" timestamp with time zone,
	CONSTRAINT "payment_batch_gateway_order_unique" UNIQUE("gateway","gateway_order_id"),
	CONSTRAINT "payment_batch_amount_positive" CHECK ("payment_batch"."amount_minor" > 0),
	CONSTRAINT "payment_batch_currency_inr" CHECK ("payment_batch"."currency" = 'INR'),
	CONSTRAINT "payment_batch_institution_matches_route" CHECK (("payment_batch"."route" = 'institution') = ("payment_batch"."institution_id" IS NOT NULL AND "payment_batch"."institution_registration_id" IS NOT NULL)),
	CONSTRAINT "payment_batch_order_when_opened" CHECK ("payment_batch"."status" NOT IN ('order_created', 'captured') OR "payment_batch"."gateway_order_id" IS NOT NULL),
	CONSTRAINT "payment_batch_payment_when_captured" CHECK ("payment_batch"."status" <> 'captured' OR ("payment_batch"."captured_at" IS NOT NULL AND "payment_batch"."gateway_payment_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "payment_batch_item" (
	"batch_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "payment_batch_item_batch_id_registration_id_pk" PRIMARY KEY("batch_id","registration_id"),
	CONSTRAINT "payment_batch_item_amount_positive" CHECK ("payment_batch_item"."amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "registration" ADD COLUMN "registration_number" text;--> statement-breakpoint
ALTER TABLE "payment_batch" ADD CONSTRAINT "payment_batch_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_batch" ADD CONSTRAINT "payment_batch_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_batch" ADD CONSTRAINT "payment_batch_institution_registration_id_institution_registration_id_fk" FOREIGN KEY ("institution_registration_id") REFERENCES "public"."institution_registration"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_batch" ADD CONSTRAINT "payment_batch_payer_user_id_user_id_fk" FOREIGN KEY ("payer_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_batch_item" ADD CONSTRAINT "payment_batch_item_batch_id_payment_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payment_batch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_batch_item" ADD CONSTRAINT "payment_batch_item_registration_id_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registration"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gateway_webhook_event_order_id_idx" ON "gateway_webhook_event" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payment_batch_institution_registration_id_idx" ON "payment_batch" USING btree ("institution_registration_id");--> statement-breakpoint
CREATE INDEX "payment_batch_competition_id_idx" ON "payment_batch" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "payment_batch_institution_id_idx" ON "payment_batch" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "payment_batch_payer_user_id_idx" ON "payment_batch" USING btree ("payer_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_batch_item_holding_unique" ON "payment_batch_item" USING btree ("registration_id") WHERE "payment_batch_item"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "payment_batch_item_registration_id_idx" ON "payment_batch_item" USING btree ("registration_id");--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_registration_number_unique" UNIQUE("registration_number");--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_number_format" CHECK ("registration"."registration_number" ~ '^[A-Z]{3,6}[0-9]{2}-R-[0-9A-HJKMNP-TV-Z]{6}$');