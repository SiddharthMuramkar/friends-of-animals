-- The production worker's role on pg-prod (#61). Applied as `postgres` by
-- docker/scripts/worker-roles.sh, which passes the password in the
-- environment (FOA_WORKER_PASSWORD), never on a command line. Idempotent.
--
--   foa_worker  docker/workers.yml's worker-prod. DML on `foa` as a member
--               of foa_app (its default privileges, FOR ROLE foa_migrator);
--               owns schema `pgboss`, where pg-boss creates its tables on
--               start. No CREATE on the database, so it can't touch
--               `public`'s tables beyond DML.
--
-- pg_hba.prod.conf lets it into `foa` from the compose network.

-- The password below: keep it out of pg_stat_statements and the server log
-- (see common.sql).
SET pg_stat_statements.track_utility = off;
SET pg_stat_statements.track = none;
SET client_min_messages = warning;
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
SET log_min_duration_statement = -1;

\getenv pw FOA_WORKER_PASSWORD
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foa_worker') AS missing \gset
\if :missing
  CREATE ROLE foa_worker;
\endif
ALTER ROLE foa_worker WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT
  NOREPLICATION NOBYPASSRLS;
-- The secret file is the truth: re-applied on every run (rotation).
ALTER ROLE foa_worker WITH PASSWORD :'pw';
\unset pw

-- A drain or a schedule's batch may run longer than the app's 15 s; a
-- stuck one still gives up.
ALTER ROLE foa_worker SET statement_timeout = '60s';
ALTER ROLE foa_worker SET lock_timeout = '10s';
ALTER ROLE foa_worker SET idle_in_transaction_session_timeout = '60s';

GRANT foa_app TO foa_worker;
GRANT CONNECT ON DATABASE foa TO foa_worker;

\connect foa
SET client_min_messages = warning;
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION foa_worker;
ALTER SCHEMA pgboss OWNER TO foa_worker;

-- Reconcile the retention grants if the worker is provisioned after migration.
DO $$
DECLARE
  message_table oid := to_regclass('public.contact_message');
  safeguarding_table oid := to_regclass('public.safeguarding_report');
BEGIN
  IF has_table_privilege('foa_app', message_table, 'SELECT')
     AND NOT has_table_privilege('foa_app', message_table, 'DELETE') THEN
    GRANT DELETE ON public.contact_message TO foa_worker;
  END IF;
  IF has_table_privilege('foa_app', safeguarding_table, 'SELECT')
     AND NOT has_table_privilege('foa_app', safeguarding_table, 'DELETE') THEN
    GRANT DELETE ON public.safeguarding_report TO foa_worker;
  END IF;
END;
$$;
