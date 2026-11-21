-- Custom SQL migration file, put your code below! --
-- Published CMS revisions never change (#111). Only a draft's row may be
-- edited or deleted. Once published, a revision's only move is to
-- superseded (when the next version is published), and nothing else about
-- it changes: not its body, number, date or publisher. A change is a new
-- draft. Whoever runs the statement, the migrator included, gets the error.
CREATE FUNCTION "cms_revision_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'draft' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'cms_revision % is %: it can''t be deleted', OLD.id, OLD.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.document_id IS DISTINCT FROM OLD.document_id
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.body IS DISTINCT FROM OLD.body
    OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.updated_at IS DISTINCT FROM OLD.updated_at
    OR NEW.published_by_user_id IS DISTINCT FROM OLD.published_by_user_id
    OR NEW.published_at IS DISTINCT FROM OLD.published_at
    OR NOT (
      NEW.status = OLD.status
      OR (OLD.status = 'published' AND NEW.status = 'superseded')
    )
  THEN
    RAISE EXCEPTION 'cms_revision % is %: it can''t change; save a new draft', OLD.id, OLD.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "cms_revision_guard"
  BEFORE UPDATE OR DELETE ON "cms_revision"
  FOR EACH ROW EXECUTE FUNCTION "cms_revision_guard"();
--> statement-breakpoint
CREATE FUNCTION "cms_revision_reject_truncate"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'cms_revision can''t be truncated: published revisions are kept'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "cms_revision_no_truncate"
  BEFORE TRUNCATE ON "cms_revision"
  FOR EACH STATEMENT EXECUTE FUNCTION "cms_revision_reject_truncate"();
