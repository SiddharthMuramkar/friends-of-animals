CREATE TYPE "public"."round_outcome" AS ENUM('winner', 'runner_up', 'finalist', 'special_mention', 'none');--> statement-breakpoint
CREATE TABLE "round_result" (
	"round_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"code" text NOT NULL,
	"discipline" "competition_discipline" NOT NULL,
	"category_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"score_numerator" text NOT NULL,
	"score_denominator" text NOT NULL,
	"sheets_counted" integer NOT NULL,
	"decided_by" jsonb,
	"outcome" "round_outcome" DEFAULT 'none' NOT NULL,
	"award_position" integer,
	"suitable_for_auction" boolean DEFAULT false NOT NULL,
	CONSTRAINT "round_result_round_id_entry_id_pk" PRIMARY KEY("round_id","entry_id"),
	CONSTRAINT "round_result_rank" CHECK ("round_result"."rank" > 0 AND "round_result"."sheets_counted" > 0),
	CONSTRAINT "round_result_fraction" CHECK ("round_result"."score_numerator" ~ '^[0-9]+$' AND "round_result"."score_denominator" ~ '^[1-9][0-9]*$'),
	CONSTRAINT "round_result_award_position" CHECK (CASE "round_result"."outcome" WHEN 'winner' THEN "round_result"."award_position" IS NOT DISTINCT FROM 1 WHEN 'runner_up' THEN "round_result"."award_position" IS NOT NULL AND "round_result"."award_position" BETWEEN 2 AND 3 ELSE "round_result"."award_position" IS NULL END)
);
--> statement-breakpoint
ALTER TABLE "judging_round" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "judging_round" ADD COLUMN "locked_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "judging_round" ADD COLUMN "lock_override_reason" text;--> statement-breakpoint
ALTER TABLE "judging_round" ADD COLUMN "tie_break_rule" text;--> statement-breakpoint
ALTER TABLE "round_result" ADD CONSTRAINT "round_result_round_id_entry_id_round_entry_round_id_entry_id_fk" FOREIGN KEY ("round_id","entry_id") REFERENCES "public"."round_entry"("round_id","entry_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judging_round" ADD CONSTRAINT "judging_round_locked_by_user_id_user_id_fk" FOREIGN KEY ("locked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "judging_round_locked_by_idx" ON "judging_round" USING btree ("locked_by_user_id");--> statement-breakpoint
ALTER TABLE "judging_round" ADD CONSTRAINT "judging_round_lock_metadata" CHECK (("judging_round"."status" = 'locked') = ("judging_round"."locked_at" IS NOT NULL AND "judging_round"."tie_break_rule" IS NOT NULL) AND ("judging_round"."lock_override_reason" IS NULL OR "judging_round"."status" = 'locked'));
--> statement-breakpoint
-- A lock freezes scoring even if a caller bypasses the application use cases.
-- Acquire the round row first, as saveScoreSheet and lockJudgingRound do.
CREATE FUNCTION "guard_score_sheet_after_lock"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE round_status judging_round_status;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Score sheets cannot be truncated';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    -- Assignment erasure cascades; direct deletion of a live sheet may not.
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM round_assignment WHERE round_id = OLD.round_id AND entry_id = OLD.entry_id AND judge_user_id = OLD.judge_user_id) THEN RETURN OLD; END IF;
    SELECT status INTO round_status FROM judging_round WHERE id = OLD.round_id FOR UPDATE;
    IF round_status = 'locked' THEN RAISE EXCEPTION 'Locked round scores are immutable'; END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT status INTO round_status FROM judging_round WHERE id = NEW.round_id FOR UPDATE;
    IF round_status = 'locked' THEN RAISE EXCEPTION 'Locked round scores are immutable'; END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "score_sheet_lock_guard" BEFORE INSERT OR UPDATE OR DELETE ON score_sheet FOR EACH ROW EXECUTE FUNCTION guard_score_sheet_after_lock();
--> statement-breakpoint
CREATE TRIGGER "score_sheet_no_truncate" BEFORE TRUNCATE ON score_sheet FOR EACH STATEMENT EXECUTE FUNCTION guard_score_sheet_after_lock();
--> statement-breakpoint
CREATE FUNCTION "guard_criterion_score_after_lock"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE round_status judging_round_status;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN RAISE EXCEPTION 'Criterion scores cannot be truncated'; END IF;
  IF TG_OP <> 'INSERT' THEN
    SELECT r.status INTO round_status FROM judging_round r JOIN score_sheet s ON s.round_id = r.id WHERE s.id = OLD.score_sheet_id FOR UPDATE OF r;
    IF round_status = 'locked' THEN RAISE EXCEPTION 'Locked round scores are immutable'; END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT r.status INTO round_status FROM judging_round r JOIN score_sheet s ON s.round_id = r.id WHERE s.id = NEW.score_sheet_id FOR UPDATE OF r;
    IF round_status = 'locked' THEN RAISE EXCEPTION 'Locked round scores are immutable'; END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "criterion_score_lock_guard" BEFORE INSERT OR UPDATE OR DELETE ON criterion_score FOR EACH ROW EXECUTE FUNCTION guard_criterion_score_after_lock();
--> statement-breakpoint
CREATE TRIGGER "criterion_score_no_truncate" BEFORE TRUNCATE ON criterion_score FOR EACH STATEMENT EXECUTE FUNCTION guard_criterion_score_after_lock();
--> statement-breakpoint
CREATE FUNCTION "guard_round_result_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE round_status judging_round_status;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN RAISE EXCEPTION 'Round results cannot be truncated'; END IF;
  IF TG_OP = 'DELETE' THEN
    -- Participant erasure removes the owning pool row (FK cascade).
    IF NOT EXISTS (SELECT 1 FROM round_entry WHERE round_id = OLD.round_id AND entry_id = OLD.entry_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Round results are immutable';
  END IF;
  SELECT status INTO round_status FROM judging_round WHERE id = NEW.round_id FOR UPDATE;
  IF TG_OP = 'INSERT' THEN
    IF round_status <> 'open' THEN RAISE EXCEPTION 'Only an open round can create a ranking snapshot'; END IF;
  ELSE
    IF round_status <> 'locked' OR (to_jsonb(NEW) - ARRAY['outcome','award_position','suitable_for_auction']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['outcome','award_position','suitable_for_auction']) THEN
      RAISE EXCEPTION 'Locked round rankings are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "round_result_mutation_guard" BEFORE INSERT OR UPDATE OR DELETE ON round_result FOR EACH ROW EXECUTE FUNCTION guard_round_result_mutation();
--> statement-breakpoint
CREATE TRIGGER "round_result_no_truncate" BEFORE TRUNCATE ON round_result FOR EACH STATEMENT EXECUTE FUNCTION guard_round_result_mutation();
--> statement-breakpoint
CREATE FUNCTION "guard_locked_round"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'locked' AND NEW.status <> 'locked' THEN RAISE EXCEPTION 'A locked round cannot reopen'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "judging_round_lock_guard" BEFORE UPDATE ON judging_round FOR EACH ROW EXECUTE FUNCTION guard_locked_round();
