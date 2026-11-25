CREATE TYPE "public"."school_round_status" AS ENUM('open', 'overdue', 'finalised', 'closed_on_behalf');--> statement-breakpoint
CREATE TABLE "school_round" (
	"id" uuid PRIMARY KEY NOT NULL,
	"competition_id" uuid NOT NULL,
	"institution_registration_id" uuid NOT NULL,
	"status" "school_round_status" NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"judging_attested_by_user_id" uuid,
	"judging_attested_at" timestamp with time zone,
	"judging_statement_version" text,
	"finalised_by_user_id" uuid,
	"finalised_at" timestamp with time zone,
	"families_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "school_round_institution_registration_unique" UNIQUE("institution_registration_id")
);
--> statement-breakpoint
CREATE TABLE "school_round_panel_member" (
	"id" uuid PRIMARY KEY NOT NULL,
	"round_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"full_name" text NOT NULL,
	"designation" text NOT NULL,
	CONSTRAINT "school_round_panel_member_round_order_unique" UNIQUE("round_id","sort_order"),
	CONSTRAINT "school_round_panel_member_order_not_negative" CHECK ("school_round_panel_member"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "school_round_pick" (
	"entry_id" uuid PRIMARY KEY NOT NULL,
	"round_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"position" integer,
	"picked_by_user_id" uuid,
	"picked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "school_round_pick_position_positive" CHECK ("school_round_pick"."position" IS NULL OR "school_round_pick"."position" >= 1)
);
--> statement-breakpoint
CREATE TABLE "school_round_transition" (
	"id" uuid PRIMARY KEY NOT NULL,
	"round_id" uuid NOT NULL,
	"from_status" "school_round_status",
	"to_status" "school_round_status" NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "school_round_transition_actor_kind" CHECK ("school_round_transition"."actor_kind" IN ('user', 'system')),
	CONSTRAINT "school_round_transition_system_has_no_user" CHECK ("school_round_transition"."actor_kind" = 'user' OR "school_round_transition"."actor_user_id" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "school_round" ADD CONSTRAINT "school_round_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_round" ADD CONSTRAINT "school_round_institution_registration_id_institution_registration_id_fk" FOREIGN KEY ("institution_registration_id") REFERENCES "public"."institution_registration"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_round" ADD CONSTRAINT "school_round_judging_attested_by_user_id_user_id_fk" FOREIGN KEY ("judging_attested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_round" ADD CONSTRAINT "school_round_finalised_by_user_id_user_id_fk" FOREIGN KEY ("finalised_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_round_panel_member" ADD CONSTRAINT "school_round_panel_member_round_id_school_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."school_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_round_pick" ADD CONSTRAINT "school_round_pick_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_round_pick" ADD CONSTRAINT "school_round_pick_round_id_school_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."school_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_round_pick" ADD CONSTRAINT "school_round_pick_category_id_competition_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."competition_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_round_pick" ADD CONSTRAINT "school_round_pick_picked_by_user_id_user_id_fk" FOREIGN KEY ("picked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_round_transition" ADD CONSTRAINT "school_round_transition_round_id_school_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."school_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_round_transition" ADD CONSTRAINT "school_round_transition_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "school_round_competition_id_idx" ON "school_round" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "school_round_judging_attested_by_user_id_idx" ON "school_round" USING btree ("judging_attested_by_user_id");--> statement-breakpoint
CREATE INDEX "school_round_finalised_by_user_id_idx" ON "school_round" USING btree ("finalised_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "school_round_pick_position_unique" ON "school_round_pick" USING btree ("round_id","category_id","position") WHERE "school_round_pick"."position" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "school_round_pick_round_id_idx" ON "school_round_pick" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "school_round_pick_category_id_idx" ON "school_round_pick" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "school_round_pick_picked_by_user_id_idx" ON "school_round_pick" USING btree ("picked_by_user_id");--> statement-breakpoint
CREATE INDEX "school_round_transition_round_id_idx" ON "school_round_transition" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "school_round_transition_actor_user_id_idx" ON "school_round_transition" USING btree ("actor_user_id");