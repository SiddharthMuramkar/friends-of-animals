-- Custom SQL migration file, put your code below! --
-- Published consent documents are immutable (#64). Any UPDATE, DELETE or
-- TRUNCATE of consent_document fails, whoever runs it, the migrator
-- included: a change is a new version, so every consent keeps pointing at
-- the exact text the person saw.
CREATE FUNCTION "consent_document_reject_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'consent_document is immutable: % is not allowed; publish a new version', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "consent_document_no_update_or_delete"
  BEFORE UPDATE OR DELETE ON "consent_document"
  FOR EACH STATEMENT EXECUTE FUNCTION "consent_document_reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "consent_document_no_truncate"
  BEFORE TRUNCATE ON "consent_document"
  FOR EACH STATEMENT EXECUTE FUNCTION "consent_document_reject_mutation"();
