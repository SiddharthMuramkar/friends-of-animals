CREATE TYPE "public"."competition_digital_scope" AS ENUM('all_participants', 'shortlist_only');--> statement-breakpoint
CREATE TYPE "public"."competition_discipline" AS ENUM('drawing', 'painting', 'art', 'craft', 'essay', 'photography', 'videography');--> statement-breakpoint
CREATE TYPE "public"."competition_key_date_kind" AS ENUM('registration_opens', 'registration_closes', 'submissions_close', 'school_round_closes');--> statement-breakpoint
CREATE TYPE "public"."competition_participation" AS ENUM('individuals', 'institutions', 'both');--> statement-breakpoint
CREATE TYPE "public"."competition_physical_artwork" AS ENUM('not_required', 'all_shortlisted', 'top_n');--> statement-breakpoint
CREATE TYPE "public"."competition_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE "competition" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"theme" text,
	"welfare_message" text,
	"rules" text,
	"permitted_materials" text,
	"duration" text,
	"participation" "competition_participation",
	"disciplines" "competition_discipline"[] DEFAULT '{}' NOT NULL,
	"age_cutoff_date" date,
	"digital_scope" "competition_digital_scope" DEFAULT 'all_participants' NOT NULL,
	"shortlist_per_category" integer DEFAULT 5 NOT NULL,
	"school_positions" integer DEFAULT 3 NOT NULL,
	"physical_artwork" "competition_physical_artwork" DEFAULT 'all_shortlisted' NOT NULL,
	"physical_artwork_top_n" integer,
	"public_display" boolean DEFAULT false NOT NULL,
	"auction_permitted" boolean DEFAULT false NOT NULL,
	"status" "competition_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "competition_code_unique" UNIQUE("code"),
	CONSTRAINT "competition_slug_unique" UNIQUE("slug"),
	CONSTRAINT "competition_code_format" CHECK ("competition"."code" ~ '^[A-Z]{3,6}[0-9]{2}$'),
	CONSTRAINT "competition_slug_format" CHECK ("competition"."slug" ~ '^[a-z0-9-]{3,80}$'),
	CONSTRAINT "competition_physical_artwork_top_n" CHECK (("competition"."physical_artwork" = 'top_n') = ("competition"."physical_artwork_top_n" IS NOT NULL)),
	CONSTRAINT "competition_counts_not_negative" CHECK ("competition"."shortlist_per_category" >= 0 AND "competition"."school_positions" >= 0),
	CONSTRAINT "competition_published_at_matches_status" CHECK (("competition"."status" = 'draft') = ("competition"."published_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "competition_age_group" (
	"id" uuid PRIMARY KEY NOT NULL,
	"competition_id" uuid NOT NULL,
	"label" text NOT NULL,
	"min_age" integer NOT NULL,
	"max_age" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "competition_age_group_position_unique" UNIQUE("competition_id","position"),
	CONSTRAINT "competition_age_group_ages_not_negative" CHECK ("competition_age_group"."min_age" >= 0 AND "competition_age_group"."max_age" >= 0)
);
--> statement-breakpoint
CREATE TABLE "competition_category" (
	"id" uuid PRIMARY KEY NOT NULL,
	"competition_id" uuid NOT NULL,
	"discipline" "competition_discipline" NOT NULL,
	"age_group_id" uuid NOT NULL,
	CONSTRAINT "competition_category_unique" UNIQUE("competition_id","discipline","age_group_id")
);
--> statement-breakpoint
CREATE TABLE "competition_key_date" (
	"competition_id" uuid NOT NULL,
	"kind" "competition_key_date_kind" NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "competition_key_date_competition_id_kind_pk" PRIMARY KEY("competition_id","kind")
);
--> statement-breakpoint
ALTER TABLE "competition" ADD CONSTRAINT "competition_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_age_group" ADD CONSTRAINT "competition_age_group_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_category" ADD CONSTRAINT "competition_category_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_category" ADD CONSTRAINT "competition_category_age_group_id_competition_age_group_id_fk" FOREIGN KEY ("age_group_id") REFERENCES "public"."competition_age_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_key_date" ADD CONSTRAINT "competition_key_date_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competition_status_idx" ON "competition" USING btree ("status");--> statement-breakpoint
CREATE INDEX "competition_created_by_user_id_idx" ON "competition" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competition_age_group_label_unique" ON "competition_age_group" USING btree ("competition_id",lower("label"));--> statement-breakpoint
CREATE INDEX "competition_category_age_group_id_idx" ON "competition_category" USING btree ("age_group_id");