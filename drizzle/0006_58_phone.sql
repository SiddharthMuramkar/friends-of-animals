ALTER TABLE "user" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone_ciphertext" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone_hash" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_phone_hash_unique" UNIQUE("phone_hash");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_email_or_phone" CHECK ("user"."email" IS NOT NULL OR "user"."phone_hash" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_phone_complete" CHECK (("user"."phone_ciphertext" IS NULL) = ("user"."phone_hash" IS NULL));