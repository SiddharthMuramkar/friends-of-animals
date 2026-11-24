-- Custom SQL migration file, put your code below! ---- A breach's timeline is append-only (#116). Any UPDATE or TRUNCATE of
-- breach_timeline_event fails, whoever runs it, and so does any DELETE but
-- one: when a breach record itself is deleted (retention, #114), ON DELETE
-- CASCADE takes its events with it. By then the breach's row is gone,
-- which is how the trigger tells that apart from deleting events of a
-- breach that still exists.
CREATE FUNCTION "breach_timeline_event_reject_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "breach_record" WHERE "id" = OLD."breach_id"
    ) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'breach_timeline_event is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "breach_timeline_event_no_update_or_delete"
  BEFORE UPDATE OR DELETE ON "breach_timeline_event"
  FOR EACH ROW EXECUTE FUNCTION "breach_timeline_event_reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "breach_timeline_event_no_truncate"
  BEFORE TRUNCATE ON "breach_timeline_event"
  FOR EACH STATEMENT EXECUTE FUNCTION "breach_timeline_event_reject_mutation"();
