-- pg-prod roles and the production database `foa`. Run by bootstrap.sh as
-- `postgres`, after common.sql. Idempotent.
--
--   foa_migrator  owns `foa` and everything in it; runs migrations (DIRECT_URL,
--                 PgBouncer session mode).
--   foa_app       the runtime role (DATABASE_URL, transaction mode): DML only,
--                 through default privileges. It cannot CREATE in public.

-- Passwords below: keep them out of pg_stat_statements and the server log
-- (see common.sql).
SET pg_stat_statements.track_utility = off;
SET client_min_messages = warning;
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
SET log_min_duration_statement = -1;

-- Roles -------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foa_migrator') AS missing \gset
\if :missing
  CREATE ROLE foa_migrator;
\endif
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foa_app') AS missing \gset
\if :missing
  CREATE ROLE foa_app;
\endif

ALTER ROLE foa_migrator WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT
  NOREPLICATION NOBYPASSRLS;
ALTER ROLE foa_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT
  NOREPLICATION NOBYPASSRLS;

SELECT :'set_passwords' = '1'
    OR (SELECT rolpassword IS NULL FROM pg_authid WHERE rolname = 'foa_migrator') AS set_pw \gset
\if :set_pw
  \set pw `cat /run/secrets/migrator_password`
  ALTER ROLE foa_migrator WITH PASSWORD :'pw';
  \unset pw
\endif
SELECT :'set_passwords' = '1'
    OR (SELECT rolpassword IS NULL FROM pg_authid WHERE rolname = 'foa_app') AS set_pw \gset
\if :set_pw
  \set pw `cat /run/secrets/app_password`
  ALTER ROLE foa_app WITH PASSWORD :'pw';
  \unset pw
\endif

-- Database ------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'foa') AS missing \gset
\if :missing
  CREATE DATABASE foa OWNER foa_migrator;
\endif
ALTER DATABASE foa OWNER TO foa_migrator;
-- Only the two app roles connect; no TEMP for foa_app (temp tables do not
-- survive transaction pooling anyway).
REVOKE ALL ON DATABASE foa FROM PUBLIC;
GRANT CONNECT ON DATABASE foa TO foa_app;

\connect foa
SET client_min_messages = warning;

-- `public` is owned by pg_database_owner, i.e. foa_migrator, who keeps CREATE.
-- Since PG 15 PUBLIC has no CREATE there; also drop PUBLIC's USAGE.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO foa_app;

-- Everything foa_migrator creates from now on: DML for foa_app, nothing more.
-- Not re-granted on existing objects on purpose: a migration may narrow a
-- table (e.g. an append-only audit log) and a rerun must not undo it.
-- Schemas other than public need `GRANT USAGE ON SCHEMA ... TO foa_app` in
-- the migration that creates them.
ALTER DEFAULT PRIVILEGES FOR ROLE foa_migrator
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO foa_app;
ALTER DEFAULT PRIVILEGES FOR ROLE foa_migrator
  GRANT USAGE, SELECT ON SEQUENCES TO foa_app;
ALTER DEFAULT PRIVILEGES FOR ROLE foa_migrator
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE foa_migrator
  GRANT EXECUTE ON FUNCTIONS TO foa_app;
