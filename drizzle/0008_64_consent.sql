CREATE TYPE "public"."consent_event_action" AS ENUM('given', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."consent_method" AS ENUM('web_form', 'otp_link', 'paper_form', 'staff_recorded');--> statement-breakpoint
CREATE TYPE "public"."consent_purpose" AS ENUM('privacy_notice', 'terms', 'messages');--> statement-breakpoint
CREATE TYPE "public"."consent_subject_type" AS ENUM('user');--> statement-breakpoint
CREATE TABLE "consent_document" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purpose" "consent_purpose" NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" jsonb NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"published_by_user_id" uuid,
	CONSTRAINT "consent_document_purpose_version_unique" UNIQUE("purpose","version"),
	CONSTRAINT "consent_document_version_positive" CHECK ("consent_document"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "consent_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_type" "consent_subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"giver_user_id" uuid,
	"purpose" "consent_purpose" NOT NULL,
	"document_id" uuid NOT NULL,
	"action" "consent_event_action" NOT NULL,
	"method" "consent_method" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consent_event" ADD CONSTRAINT "consent_event_giver_user_id_user_id_fk" FOREIGN KEY ("giver_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_event" ADD CONSTRAINT "consent_event_document_id_consent_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."consent_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_event_subject_idx" ON "consent_event" USING btree ("subject_type","subject_id","purpose","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "consent_event_document_id_idx" ON "consent_event" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "consent_event_giver_user_id_idx" ON "consent_event" USING btree ("giver_user_id");