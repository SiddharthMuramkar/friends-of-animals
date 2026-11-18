-- Shared by pg-prod and pg-nonprod. Run by bootstrap.sh as `postgres` in the
-- maintenance database `postgres`. Idempotent.
--
-- psql variable set_passwords (0/1) comes from bootstrap.sh.

-- Some statements below carry passwords: keep them out of pg_stat_statements
-- (track_utility is off in postgresql.conf too) and out of the server log,
-- even if they fail.
SET pg_stat_statements.track_utility = off;
SET client_min_messages = warning;
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
SET log_min_duration_statement = -1;

-- Superuser ---------------------------------------------------------------------
-- The entrypoint sets its password on first init (POSTGRES_PASSWORD_FILE).
-- It is used only over the container socket or an SSH tunnel (pg_hba.conf).
SELECT :'set_passwords' = '1' AS set_pw \gset
\if :set_pw
  \set pw `cat /run/secrets/postgres_password`
  ALTER ROLE postgres WITH PASSWORD :'pw';
  \unset pw
\endif

-- pgbouncer_auth: the role PgBouncer's auth_query runs as -----------------------
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pgbouncer_auth') AS missing \gset
\if :missing
  CREATE ROLE pgbouncer_auth;
\endif
ALTER ROLE pgbouncer_auth WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 10;
SELECT :'set_passwords' = '1'
    OR (SELECT rolpassword IS NULL FROM pg_authid WHERE rolname = 'pgbouncer_auth') AS set_pw \gset
\if :set_pw
  \set pw `cat /run/secrets/pgbouncer_auth_password`
  ALTER ROLE pgbouncer_auth WITH PASSWORD :'pw';
  \unset pw
\endif

-- The lookup function. auth_query runs in the database named by auth_dbname,
-- which is this server's `postgres` database for both PgBouncer entries, so it
-- lives only here (not in foa, foa_seed or the previews).
--
-- It never returns a secret for superusers, replication or BYPASSRLS roles,
-- roles that cannot log in, or pgbouncer_auth itself. An expired role gets a
-- NULL secret, which PgBouncer treats as "no password accepted".
CREATE SCHEMA IF NOT EXISTS pgbouncer AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA pgbouncer FROM PUBLIC;
GRANT USAGE ON SCHEMA pgbouncer TO pgbouncer_auth;

CREATE OR REPLACE FUNCTION pgbouncer.get_auth(p_usename text)
  RETURNS TABLE (usename name, passwd text)
  LANGUAGE sql STABLE STRICT SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT a.rolname,
         CASE WHEN a.rolvaliduntil < now() THEN NULL ELSE a.rolpassword END
    FROM pg_catalog.pg_authid AS a
   WHERE a.rolname = p_usename
     AND a.rolcanlogin
     AND NOT a.rolsuper
     AND NOT a.rolreplication
     AND NOT a.rolbypassrls
     AND a.rolname <> 'pgbouncer_auth'
$fn$;
ALTER FUNCTION pgbouncer.get_auth(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION pgbouncer.get_auth(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pgbouncer.get_auth(text) TO pgbouncer_auth;

-- The maintenance databases: no implicit access ------------------------------------
REVOKE ALL ON DATABASE postgres FROM PUBLIC;
GRANT CONNECT ON DATABASE postgres TO pgbouncer_auth;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;

-- Query statistics for admins (preloaded in postgresql.conf).
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
