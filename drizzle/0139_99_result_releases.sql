CREATE TYPE "public"."result_release_status" AS ENUM('pending_approval', 'approved', 'published', 'rejected');--> statement-breakpoint
CREATE TABLE "result_award" (
	"release_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"discipline" "competition_discipline" NOT NULL,
	"category_id" uuid NOT NULL,
	"category_label" text NOT NULL,
	"outcome" "round_outcome" NOT NULL,
	"award_position" integer,
	"award_band" text,
	"prize" text,
	"suitable_for_auction" boolean NOT NULL,
	CONSTRAINT "result_award_release_id_entry_id_pk" PRIMARY KEY("release_id","entry_id"),
	CONSTRAINT "result_award_recognition" CHECK (("result_award"."outcome" <> 'none' OR "result_award"."suitable_for_auction") AND ("result_award"."outcome" IN ('winner','runner_up')) = ("result_award"."award_position" IS NOT NULL AND "result_award"."award_band" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "result_release" (
	"id" uuid PRIMARY KEY NOT NULL,
	"competition_id" uuid NOT NULL,
	"source_round_id" uuid NOT NULL,
	"status" "result_release_status" DEFAULT 'pending_approval' NOT NULL,
	"prepared_by_user_id" uuid,
	"prepared_at" timestamp with time zone NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"publish_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"content_hash" text NOT NULL,
	"delivery_note" text NOT NULL,
	CONSTRAINT "release_distinct_staff" CHECK ("result_release"."prepared_by_user_id" IS NULL OR "result_release"."approved_by_user_id" IS NULL OR "result_release"."prepared_by_user_id" <> "result_release"."approved_by_user_id"),
	CONSTRAINT "release_times" CHECK ("result_release"."publish_at" > "result_release"."prepared_at" AND ("result_release"."published_at" IS NULL OR "result_release"."published_at" >= "result_release"."publish_at") AND ("result_release"."status" = 'published') = ("result_release"."published_at" IS NOT NULL) AND ("result_release"."status" = 'rejected') = ("result_release"."rejected_at" IS NOT NULL) AND ("result_release"."status" NOT IN ('approved', 'published') OR "result_release"."approved_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "result_award" ADD CONSTRAINT "result_award_release_id_result_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."result_release"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_award" ADD CONSTRAINT "result_award_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_release" ADD CONSTRAINT "result_release_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_release" ADD CONSTRAINT "result_release_source_round_id_judging_round_id_fk" FOREIGN KEY ("source_round_id") REFERENCES "public"."judging_round"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_release" ADD CONSTRAINT "result_release_prepared_by_user_id_user_id_fk" FOREIGN KEY ("prepared_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_release" ADD CONSTRAINT "result_release_approved_by_user_id_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "result_award_entry_idx" ON "result_award" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "result_release_active" ON "result_release" USING btree ("competition_id") WHERE "result_release"."status" <> 'rejected';--> statement-breakpoint
CREATE INDEX "result_release_source_idx" ON "result_release" USING btree ("source_round_id");--> statement-breakpoint
CREATE INDEX "result_release_competition_idx" ON "result_release" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "result_release_preparer_idx" ON "result_release" USING btree ("prepared_by_user_id");--> statement-breakpoint
CREATE INDEX "result_release_approver_idx" ON "result_release" USING btree ("approved_by_user_id");
--> statement-breakpoint
-- Release content is frozen before the second staff member approves it.
-- Staff erasure may null their actor associations; it cannot rewrite content.
CREATE FUNCTION result_release_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW.competition_id, NEW.source_round_id, NEW.prepared_at, NEW.publish_at, NEW.delivery_note, NEW.content_hash)
    IS DISTINCT FROM ROW(OLD.id, OLD.competition_id, OLD.source_round_id, OLD.prepared_at, OLD.publish_at, OLD.delivery_note, OLD.content_hash) THEN
    RAISE EXCEPTION 'Release content is immutable';
  END IF;
  IF (OLD.status <> NEW.status AND NOT (
    (OLD.status = 'pending_approval' AND NEW.status IN ('approved','rejected')) OR
    (OLD.status = 'approved' AND NEW.status IN ('published','rejected'))
  )) THEN RAISE EXCEPTION 'Invalid release transition'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER result_release_freeze_trigger BEFORE UPDATE ON result_release FOR EACH ROW EXECUTE FUNCTION result_release_freeze();
--> statement-breakpoint
CREATE FUNCTION result_award_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status result_release_status;
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM entry WHERE id = OLD.entry_id) THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Release awards are immutable'; END IF;
  SELECT status INTO parent_status FROM result_release WHERE id = NEW.release_id FOR UPDATE;
  IF parent_status <> 'pending_approval' THEN RAISE EXCEPTION 'Release awards are sealed'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER result_award_freeze_trigger BEFORE INSERT OR UPDATE OR DELETE ON result_award FOR EACH ROW EXECUTE FUNCTION result_award_freeze();
--> statement-breakpoint
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('results.prize', 'email', 'Recognition at {{competition.name}}',
   E'Hello {{recipient.name}},\n\nCongratulations to {{participant.name}} on receiving {{award.name}} at {{competition.name}}.\n\nPrize or recognition: {{award.prize}}\nHow to receive it: {{award.delivery}}\n\nThank you for taking part.\nFriends of Animals',
   '["recipient.name", "competition.name", "participant.name", "award.name", "award.prize", "award.delivery"]', now()),
  ('results.prize', 'in_app', 'Recognition at {{competition.name}}',
   E'Congratulations to {{participant.name}} on receiving {{award.name}}.\nRecognition: {{award.prize}}.\nHow to receive it: {{award.delivery}}',
   '["competition.name", "participant.name", "award.name", "award.prize", "award.delivery"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('results.prize_awarded', 'family_contact', 'results.prize', '{email}', false, now()),
  ('results.prize_awarded', 'prize_recipients', 'results.prize', '{email,in_app}', false, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
