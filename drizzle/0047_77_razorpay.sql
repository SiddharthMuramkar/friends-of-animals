CREATE TABLE "gateway_test_order" (
	"id" text PRIMARY KEY NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"receipt" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gateway_test_order_amount_positive" CHECK ("gateway_test_order"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "gateway_test_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"status" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gateway_test_payment" ADD CONSTRAINT "gateway_test_payment_order_id_gateway_test_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."gateway_test_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gateway_test_payment_order_id_idx" ON "gateway_test_payment" USING btree ("order_id");