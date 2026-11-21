CREATE TYPE "public"."second_factor_kind" AS ENUM('totp', 'passkey');--> statement-breakpoint
CREATE TABLE "second_factor" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "second_factor_kind" NOT NULL,
	"label" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"totp_secret_sealed" text,
	"totp_last_used_step" bigint,
	"credential_id" text,
	"public_key" text,
	"sign_count" bigint,
	"transports" text[],
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "second_factor_credential_id_unique" UNIQUE("credential_id"),
	CONSTRAINT "second_factor_totp_fields" CHECK ("second_factor"."kind" <> 'totp' OR ("second_factor"."totp_secret_sealed" IS NOT NULL AND "second_factor"."credential_id" IS NULL AND "second_factor"."public_key" IS NULL)),
	CONSTRAINT "second_factor_passkey_fields" CHECK ("second_factor"."kind" <> 'passkey' OR ("second_factor"."credential_id" IS NOT NULL AND "second_factor"."public_key" IS NOT NULL AND "second_factor"."sign_count" IS NOT NULL AND "second_factor"."confirmed_at" IS NOT NULL AND "second_factor"."totp_secret_sealed" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "second_factor_lockout" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"failures" integer NOT NULL,
	"window_started_at" timestamp with time zone,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "session_second_factor" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"method" "second_factor_kind" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webauthn_challenge" (
	"session_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"challenge" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "webauthn_challenge_session_id_purpose_pk" PRIMARY KEY("session_id","purpose")
);
--> statement-breakpoint
ALTER TABLE "second_factor" ADD CONSTRAINT "second_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "second_factor_lockout" ADD CONSTRAINT "second_factor_lockout_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_second_factor" ADD CONSTRAINT "session_second_factor_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_challenge" ADD CONSTRAINT "webauthn_challenge_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "second_factor_user_id_idx" ON "second_factor" USING btree ("user_id");