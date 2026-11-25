CREATE TYPE "public"."recurring_donation_status" AS ENUM('pending_authorisation', 'active', 'past_due', 'halted', 'cancelled', 'completed');--> statement-breakpoint
ALTER TYPE "public"."refund_kind" ADD VALUE 'recurring_after_cancel';--> statement-breakpoint
CREATE TABLE "gateway_plan" (
	"gateway" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"gateway_plan_id" text PRIMARY KEY NOT NULL,
	CONSTRAINT "gateway_plan_amount_unique" UNIQUE("gateway","amount_minor"),
	CONSTRAINT "gateway_plan_positive" CHECK ("gateway_plan"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "gateway_test_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"amount_minor" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateway_test_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"status" text NOT NULL,
	"current_start" timestamp with time zone,
	"charge_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"notes" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_charge_failure" (
	"recurring_donation_id" uuid NOT NULL,
	"cycle_key" text NOT NULL,
	"notified_at" timestamp with time zone NOT NULL,
	CONSTRAINT "recurring_charge_failure_cycle" UNIQUE("recurring_donation_id","cycle_key")
);
--> statement-breakpoint
CREATE TABLE "recurring_donation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"donor_id" uuid NOT NULL,
	"user_id" uuid,
	"amount_minor" bigint NOT NULL,
	"status" "recurring_donation_status" NOT NULL,
	"gateway" text NOT NULL,
	"gateway_plan_id" text NOT NULL,
	"gateway_subscription_id" text NOT NULL,
	"show_on_wall" boolean NOT NULL,
	"wall_name" text,
	"next_charge_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"cancel_requested_by" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "recurring_donation_gateway_subscription_id_unique" UNIQUE("gateway_subscription_id"),
	CONSTRAINT "recurring_donation_positive" CHECK ("recurring_donation"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "recurring_refused_charge" (
	"gateway_payment_id" text PRIMARY KEY NOT NULL,
	"recurring_donation_id" uuid NOT NULL,
	"refund_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "donation" ADD COLUMN "recurring_donation_id" uuid;--> statement-breakpoint
ALTER TABLE "recurring_charge_failure" ADD CONSTRAINT "recurring_charge_failure_recurring_donation_id_recurring_donation_id_fk" FOREIGN KEY ("recurring_donation_id") REFERENCES "public"."recurring_donation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_donation" ADD CONSTRAINT "recurring_donation_donor_id_donor_id_fk" FOREIGN KEY ("donor_id") REFERENCES "public"."donor"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_donation" ADD CONSTRAINT "recurring_donation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_donation" ADD CONSTRAINT "recurring_donation_gateway_plan_id_gateway_plan_gateway_plan_id_fk" FOREIGN KEY ("gateway_plan_id") REFERENCES "public"."gateway_plan"("gateway_plan_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_refused_charge" ADD CONSTRAINT "recurring_refused_charge_recurring_donation_id_recurring_donation_id_fk" FOREIGN KEY ("recurring_donation_id") REFERENCES "public"."recurring_donation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_refused_charge" ADD CONSTRAINT "recurring_refused_charge_refund_id_refund_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refund"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurring_donation_user_idx" ON "recurring_donation" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "donation" ADD CONSTRAINT "donation_recurring_donation_id_recurring_donation_id_fk" FOREIGN KEY ("recurring_donation_id") REFERENCES "public"."recurring_donation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation" ADD CONSTRAINT "donation_gateway_payment_unique" UNIQUE("gateway_payment_id");