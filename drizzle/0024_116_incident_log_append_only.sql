-- Custom SQL migration file, put your code below! --
-- A safeguarding report's incident log is append-only (#116). Any UPDATE
-- or TRUNCATE of safeguarding_incident_log fails, whoever runs it, and so
-- does any DELETE but one: when a report itself is deleted (retention,
-- #114), ON DELETE CASCADE takes its entries with it. By then the report's
-- row is gone, which is how the trigger tells that apart from deleting
-- entries of a report that still exists.
CREATE FUNCTION "safeguarding_incident_log_reject_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "safeguarding_report" WHERE "id" = OLD."report_id"
    ) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'safeguarding_incident_log is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "safeguarding_incident_log_no_update_or_delete"
  BEFORE UPDATE OR DELETE ON "safeguarding_incident_log"
  FOR EACH ROW EXECUTE FUNCTION "safeguarding_incident_log_reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "safeguarding_incident_log_no_truncate"
  BEFORE TRUNCATE ON "safeguarding_incident_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "safeguarding_incident_log_reject_mutation"();
