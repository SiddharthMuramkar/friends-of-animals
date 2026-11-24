-- Custom SQL migration file, put your code below! --
-- Reserve parent deletion for retention. PostgreSQL cascades to the
-- append-only contact notes and safeguarding incident log.
REVOKE UPDATE, DELETE, TRUNCATE ON public.contact_note, public.safeguarding_incident_log FROM PUBLIC;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON public.contact_message, public.safeguarding_report FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE
  entry record;
BEGIN
  -- Strip DML inherited from the migrator's default privileges.
  FOR entry IN
    SELECT DISTINCT c.relname AS table_name, r.rolname AS role_name
    FROM pg_class AS c
    CROSS JOIN LATERAL aclexplode(c.relacl) AS acl
    JOIN pg_roles AS r ON r.oid = acl.grantee
    WHERE c.oid IN ('public.contact_note'::regclass, 'public.contact_message'::regclass,
                    'public.safeguarding_incident_log'::regclass, 'public.safeguarding_report'::regclass)
      AND r.oid <> c.relowner
      AND (acl.privilege_type IN ('DELETE', 'TRUNCATE')
        OR (c.relname IN ('contact_note', 'safeguarding_incident_log') AND acl.privilege_type = 'UPDATE'))
  LOOP
    IF entry.table_name IN ('contact_note', 'safeguarding_incident_log') THEN
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON public.%I FROM %I', entry.table_name, entry.role_name);
    ELSE
      EXECUTE format('REVOKE DELETE, TRUNCATE ON public.%I FROM %I', entry.table_name, entry.role_name);
    END IF;
  END LOOP;

  -- The installed worker inherits the app's read/write grants. Match the
  -- app that can read this database so staging and previews stay scoped.
  FOR entry IN
    SELECT worker.rolname AS role_name, parent.table_name
    FROM (VALUES ('foa_app', 'foa_worker'), ('staging_app', 'staging_worker'),
                 ('nonprod_app', 'nonprod_worker')) AS roles(app_role, worker_role)
    JOIN pg_roles AS app ON app.rolname = roles.app_role
    JOIN pg_roles AS worker ON worker.rolname = roles.worker_role
    CROSS JOIN (VALUES ('contact_message'), ('safeguarding_report')) AS parent(table_name)
    WHERE pg_has_role(worker.oid, app.oid, 'USAGE')
      AND has_table_privilege(app.oid, format('public.%I', parent.table_name), 'SELECT')
  LOOP
    EXECUTE format('GRANT DELETE ON public.%I TO %I', entry.table_name, entry.role_name);
  END LOOP;
END;
$$;
