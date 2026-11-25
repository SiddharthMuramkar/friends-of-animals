-- Preserve custody evidence while its artwork exists. Privacy erasure may
-- delete the entire artwork, including the dependent trail.
CREATE FUNCTION "artwork_custody_event_reject_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM "physical_artwork" WHERE "id" = OLD."artwork_id") THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'artwork_custody_event is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "artwork_custody_event_no_update_or_delete"
 BEFORE UPDATE OR DELETE ON "artwork_custody_event" FOR EACH ROW
 EXECUTE FUNCTION "artwork_custody_event_reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "artwork_custody_event_no_truncate"
 BEFORE TRUNCATE ON "artwork_custody_event" FOR EACH STATEMENT
 EXECUTE FUNCTION "artwork_custody_event_reject_mutation"();
--> statement-breakpoint
-- Existing received works predate this trail.
INSERT INTO "artwork_custody_event" ("id","artwork_id","kind","actor_user_id","at")
SELECT "id","id",'received',"received_by","received_at" FROM "physical_artwork"
WHERE "received_at" IS NOT NULL;
