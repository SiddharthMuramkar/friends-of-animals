CREATE TYPE "public"."payment_purpose" AS ENUM('registration_fee', 'donation');--> statement-breakpoint
CREATE TYPE "public"."donation_origin" AS ENUM('online_checkout', 'offline_entry', 'recurring_charge');--> statement-breakpoint
CREATE TYPE "public"."donation_status" AS ENUM('pending', 'captured', 'failed', 'expired', 'refund_pending', 'refunded', 'partially_refunded');--> statement-breakpoint
CREATE TYPE "public"."donor_type" AS ENUM('individual', 'corporate', 'csr');--> statement-breakpoint
CREATE TABLE "donation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"donor_id" uuid NOT NULL,
	"origin" "donation_origin" NOT NULL,
	"status" "donation_status" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"show_on_wall" boolean DEFAULT false NOT NULL,
	"wall_name" text,
	"declared_adult" boolean NOT NULL,
	"declared_indian_source" boolean NOT NULL,
	"payment_batch_id" uuid,
	"checkout_token_hash" text,
	"gateway_payment_id" text,
	"expires_at" timestamp with time zone,
	"captured_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "donation_payment_batch_unique" UNIQUE("payment_batch_id"),
	CONSTRAINT "donation_checkout_token_hash_unique" UNIQUE("checkout_token_hash"),
	CONSTRAINT "donation_amount_positive" CHECK ("donation"."amount_minor" > 0),
	CONSTRAINT "donation_currency_inr" CHECK ("donation"."currency" = 'INR'),
	CONSTRAINT "donation_declarations_made" CHECK ("donation"."declared_adult" AND "donation"."declared_indian_source"),
	CONSTRAINT "donation_wall_name_when_shown" CHECK ("donation"."show_on_wall" OR "donation"."wall_name" IS NULL),
	CONSTRAINT "donation_online_has_batch" CHECK ("donation"."origin" <> 'online_checkout' OR ("donation"."payment_batch_id" IS NOT NULL AND "donation"."checkout_token_hash" IS NOT NULL AND "donation"."expires_at" IS NOT NULL)),
	CONSTRAINT "donation_captured_at_when_kept" CHECK ("donation"."status" NOT IN ('captured', 'partially_refunded') OR "donation"."captured_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "donor" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"type" "donor_type" NOT NULL,
	"name_ciphertext" text NOT NULL,
	"email_ciphertext" text NOT NULL,
	"email_hash" text NOT NULL,
	"organisation_name" text,
	"disclose_organisation" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "donor_organisation_matches_type" CHECK (("donor"."type" = 'individual') = ("donor"."organisation_name" IS NULL)),
	CONSTRAINT "donor_individual_discloses_nothing" CHECK ("donor"."type" <> 'individual' OR NOT "donor"."disclose_organisation")
);
--> statement-breakpoint
CREATE TABLE "receipt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"donation_id" uuid NOT NULL,
	"fy" char(4) NOT NULL,
	"seq" integer NOT NULL,
	"number" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"snapshot" jsonb NOT NULL,
	"template_version" smallint NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "receipt_donation_unique" UNIQUE("donation_id"),
	CONSTRAINT "receipt_fy_seq_unique" UNIQUE("fy","seq"),
	CONSTRAINT "receipt_number_unique" UNIQUE("number"),
	CONSTRAINT "receipt_seq_positive" CHECK ("receipt"."seq" BETWEEN 1 AND 999999)
);
--> statement-breakpoint
CREATE TABLE "receipt_link" (
	"id" uuid PRIMARY KEY NOT NULL,
	"receipt_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"issued_to" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "receipt_link_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "receipt_link_expires_after_creation" CHECK ("receipt_link"."expires_at" > "receipt_link"."created_at")
);
--> statement-breakpoint
CREATE TABLE "receipt_sequence" (
	"fy" char(4) PRIMARY KEY NOT NULL,
	"last_seq" integer NOT NULL,
	CONSTRAINT "receipt_sequence_in_range" CHECK ("receipt_sequence"."last_seq" BETWEEN 0 AND 999999)
);
--> statement-breakpoint
ALTER TABLE "payment_batch" ALTER COLUMN "route" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_batch" ALTER COLUMN "competition_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_batch" ADD COLUMN "purpose" "payment_purpose" DEFAULT 'registration_fee' NOT NULL;--> statement-breakpoint
ALTER TABLE "donation" ADD CONSTRAINT "donation_donor_id_donor_id_fk" FOREIGN KEY ("donor_id") REFERENCES "public"."donor"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation" ADD CONSTRAINT "donation_payment_batch_id_payment_batch_id_fk" FOREIGN KEY ("payment_batch_id") REFERENCES "public"."payment_batch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donor" ADD CONSTRAINT "donor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_donation_id_donation_id_fk" FOREIGN KEY ("donation_id") REFERENCES "public"."donation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_link" ADD CONSTRAINT "receipt_link_receipt_id_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_link" ADD CONSTRAINT "receipt_link_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "donation_donor_id_idx" ON "donation" USING btree ("donor_id");--> statement-breakpoint
CREATE INDEX "donation_status_created_at_idx" ON "donation" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "donation_created_at_idx" ON "donation" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "donor_email_hash_idx" ON "donor" USING btree ("email_hash");--> statement-breakpoint
CREATE INDEX "donor_user_id_idx" ON "donor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "receipt_link_receipt_id_idx" ON "receipt_link" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "receipt_link_created_by_user_id_idx" ON "receipt_link" USING btree ("created_by_user_id");--> statement-breakpoint
ALTER TABLE "payment_batch" ADD CONSTRAINT "payment_batch_purpose_matches_subject" CHECK (("payment_batch"."purpose" = 'registration_fee') = ("payment_batch"."competition_id" IS NOT NULL AND "payment_batch"."route" IS NOT NULL));