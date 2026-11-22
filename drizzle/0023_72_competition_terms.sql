CREATE TYPE "public"."award_round" AS ENUM('school', 'foa_final');--> statement-breakpoint
CREATE TYPE "public"."award_scheme" AS ENUM('ranked_123', 'medals_gsb', 'grades_ab');--> statement-breakpoint
CREATE TYPE "public"."participation_route" AS ENUM('individual', 'institution');--> statement-breakpoint
ALTER TYPE "public"."consent_purpose" ADD VALUE 'competition_terms';--> statement-breakpoint
CREATE TABLE "competition_award_scheme" (
	"competition_id" uuid NOT NULL,
	"round" "award_round" NOT NULL,
	"scheme" "award_scheme" DEFAULT 'ranked_123' NOT NULL,
	"prizes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "competition_award_scheme_competition_id_round_pk" PRIMARY KEY("competition_id","round"),
	CONSTRAINT "competition_award_scheme_prizes_object" CHECK (jsonb_typeof("competition_award_scheme"."prizes") = 'object')
);
--> statement-breakpoint
CREATE TABLE "competition_consent_document" (
	"competition_id" uuid NOT NULL,
	"purpose" "consent_purpose" NOT NULL,
	"consent_document_id" uuid NOT NULL,
	"attached_by_user_id" uuid,
	"attached_at" timestamp with time zone NOT NULL,
	CONSTRAINT "competition_consent_document_competition_id_purpose_pk" PRIMARY KEY("competition_id","purpose")
);
--> statement-breakpoint
CREATE TABLE "competition_fee" (
	"competition_id" uuid NOT NULL,
	"route" "participation_route" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "competition_fee_competition_id_route_pk" PRIMARY KEY("competition_id","route"),
	CONSTRAINT "competition_fee_amount_not_negative" CHECK ("competition_fee"."amount_minor" >= 0),
	CONSTRAINT "competition_fee_currency_inr" CHECK ("competition_fee"."currency" = 'INR')
);
--> statement-breakpoint
ALTER TABLE "competition_award_scheme" ADD CONSTRAINT "competition_award_scheme_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_award_scheme" ADD CONSTRAINT "competition_award_scheme_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_consent_document" ADD CONSTRAINT "competition_consent_document_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_consent_document" ADD CONSTRAINT "competition_consent_document_consent_document_id_consent_document_id_fk" FOREIGN KEY ("consent_document_id") REFERENCES "public"."consent_document"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_consent_document" ADD CONSTRAINT "competition_consent_document_attached_by_user_id_user_id_fk" FOREIGN KEY ("attached_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_fee" ADD CONSTRAINT "competition_fee_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_fee" ADD CONSTRAINT "competition_fee_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competition_award_scheme_updated_by_user_id_idx" ON "competition_award_scheme" USING btree ("updated_by_user_id");--> statement-breakpoint
CREATE INDEX "competition_consent_document_consent_document_id_idx" ON "competition_consent_document" USING btree ("consent_document_id");--> statement-breakpoint
CREATE INDEX "competition_consent_document_attached_by_user_id_idx" ON "competition_consent_document" USING btree ("attached_by_user_id");--> statement-breakpoint
CREATE INDEX "competition_fee_updated_by_user_id_idx" ON "competition_fee" USING btree ("updated_by_user_id");