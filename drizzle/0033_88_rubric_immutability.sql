-- Custom SQL migration file, put your code below! --
-- Published rubrics are frozen (#88). Once a rubric leaves draft, nothing
-- may change what it says: its criteria can't be added, edited or deleted,
-- and the rubric row itself can't be deleted or rewritten. The two changes
-- allowed are publishing a newer version (status published -> superseded)
-- and deleting a user who created or published it (the reference goes to
-- null). Refusals raise SQLSTATE RB001, which the use cases map to
-- rubric_not_editable (src/server/modules/judging/domain/rubric-freeze.ts).
CREATE FUNCTION "rubric_refuse_frozen_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'draft' THEN
      RAISE EXCEPTION 'rubric % is %: it can''t be deleted', OLD."id", OLD."status"
        USING ERRCODE = 'RB001';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'draft' THEN
    RETURN NEW;
  END IF;
  IF (NEW."id", NEW."competition_id", NEW."discipline", NEW."version",
      NEW."created_at", NEW."published_at")
       IS NOT DISTINCT FROM
     (OLD."id", OLD."competition_id", OLD."discipline", OLD."version",
      OLD."created_at", OLD."published_at")
     AND (NEW."created_by_user_id" IS NOT DISTINCT FROM OLD."created_by_user_id"
          OR NEW."created_by_user_id" IS NULL)
     AND (NEW."published_by_user_id" IS NOT DISTINCT FROM OLD."published_by_user_id"
          OR NEW."published_by_user_id" IS NULL)
     AND (NEW."status" = OLD."status"
          OR (OLD."status" = 'published' AND NEW."status" = 'superseded'))
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'rubric % is %: it can''t be changed', OLD."id", OLD."status"
    USING ERRCODE = 'RB001';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "rubric_frozen_once_published"
  BEFORE UPDATE OR DELETE ON "rubric"
  FOR EACH ROW EXECUTE FUNCTION "rubric_refuse_frozen_change"();
--> statement-breakpoint
CREATE FUNCTION "rubric_criterion_refuse_frozen_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  frozen "rubric_status";
BEGIN
  -- The rubric a row leaves (update, delete) and the one it joins (insert,
  -- update) must both be drafts. A rubric that is gone is a draft being
  -- deleted, whose criteria go with it.
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "status" INTO frozen FROM "rubric"
      WHERE "id" = OLD."rubric_id" AND "status" <> 'draft';
    IF FOUND THEN
      RAISE EXCEPTION 'rubric % is %: its criteria can''t change', OLD."rubric_id", frozen
        USING ERRCODE = 'RB001';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "status" INTO frozen FROM "rubric"
      WHERE "id" = NEW."rubric_id" AND "status" <> 'draft';
    IF FOUND THEN
      RAISE EXCEPTION 'rubric % is %: its criteria can''t change', NEW."rubric_id", frozen
        USING ERRCODE = 'RB001';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "rubric_criterion_frozen_once_published"
  BEFORE INSERT OR UPDATE OR DELETE ON "rubric_criterion"
  FOR EACH ROW EXECUTE FUNCTION "rubric_criterion_refuse_frozen_change"();
