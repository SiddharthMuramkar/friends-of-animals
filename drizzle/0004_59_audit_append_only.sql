-- Custom SQL migration file, put your code below! --
-- The audit log is append-only (#59). Any UPDATE, DELETE or TRUNCATE of
-- audit_log fails, whoever runs it, the migrator included. Fixing or
-- erasing an entry needs the database owner to drop these triggers first,
-- on purpose and on the record.
CREATE FUNCTION "audit_log_reject_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_log_no_update_or_delete"
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_log_reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "audit_log_no_truncate"
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_log_reject_mutation"();
