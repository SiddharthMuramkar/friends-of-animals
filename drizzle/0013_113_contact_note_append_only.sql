-- Custom SQL migration file, put your code below! --
-- Contact notes are never edited (#113): what staff wrote stays as they
-- wrote it. An UPDATE that changes a note's words, message, time or id
-- fails. Two changes still pass: the author's id going null when their
-- account is deleted (the foreign key's ON DELETE SET NULL), and DELETE,
-- which removes a note with its message under retention.
CREATE FUNCTION "contact_note_reject_edit"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.message_id IS DISTINCT FROM OLD.message_id
    OR NEW.body IS DISTINCT FROM OLD.body
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (NEW.author_user_id IS DISTINCT FROM OLD.author_user_id
        AND NEW.author_user_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'contact_note is never edited'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "contact_note_no_edit"
  BEFORE UPDATE ON "contact_note"
  FOR EACH ROW EXECUTE FUNCTION "contact_note_reject_edit"();
