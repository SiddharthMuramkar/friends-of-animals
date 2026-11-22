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
--> statement-breakpoint
-- Belt and braces: take UPDATE, DELETE and TRUNCATE away from every role
-- but the owner, including rights the app role got by default privileges
-- when the table was created. Roles are read from the table's ACL, so no
-- role is named here.
DO $$
DECLARE
  holder oid;
BEGIN
  FOR holder IN
    SELECT DISTINCT acl.grantee
    FROM pg_class AS c
    CROSS JOIN LATERAL aclexplode(c.relacl) AS acl
    WHERE c.oid = 'public.audit_log'::regclass
      AND acl.grantee <> c.relowner
      AND acl.privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')
  LOOP
    IF holder = 0 THEN
      REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_log" FROM PUBLIC;
    ELSE
      EXECUTE format(
        'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_log" FROM %I',
        (SELECT rolname FROM pg_roles WHERE oid = holder)
      );
    END IF;
  END LOOP;
END;
$$;
