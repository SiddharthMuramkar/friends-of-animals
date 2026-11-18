-- pg-nonprod roles, the preview template `foa_seed` and `foa_staging`. Run by
-- bootstrap.sh as `postgres`, after common.sql. Idempotent.
--
--   nonprod_migrator  CREATEDB; owns foa_seed, foa_staging and every preview
--                     database it creates (`CREATE DATABASE foa_pr_<n>
--                     TEMPLATE foa_seed`, connected to database `postgres`).
--   nonprod_app       runtime role for staging and previews: DML only.
--
-- No production data ever lands here (spec §13.8).

-- Passwords below: keep them out of pg_stat_statements and the server log
-- (see common.sql).
SET pg_stat_statements.track_utility = off;
SET client_min_messages = warning;
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
SET log_min_duration_statement = -1;

-- Roles -------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nonprod_migrator') AS missing \gset
\if :missing
  CREATE ROLE nonprod_migrator;
\endif
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nonprod_app') AS missing \gset
\if :missing
  CREATE ROLE nonprod_app;
\endif

ALTER ROLE nonprod_migrator WITH LOGIN NOSUPERUSER CREATEDB NOCREATEROLE INHERIT
  NOREPLICATION NOBYPASSRLS;
ALTER ROLE nonprod_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT
  NOREPLICATION NOBYPASSRLS;

SELECT :'set_passwords' = '1'
    OR (SELECT rolpassword IS NULL FROM pg_authid WHERE rolname = 'nonprod_migrator') AS set_pw \gset
\if :set_pw
  \set pw `cat /run/secrets/migrator_password`
  ALTER ROLE nonprod_migrator WITH PASSWORD :'pw';
  \unset pw
\endif
SELECT :'set_passwords' = '1'
    OR (SELECT rolpassword IS NULL FROM pg_authid WHERE rolname = 'nonprod_app') AS set_pw \gset
\if :set_pw
  \set pw `cat /run/secrets/app_password`
  ALTER ROLE nonprod_app WITH PASSWORD :'pw';
  \unset pw
\endif

-- Preview builds connect to `postgres` to create their database.
GRANT CONNECT ON DATABASE postgres TO nonprod_migrator;

-- foa_seed: the template every preview is cloned from -------------------------------
-- It holds the default privileges below and nothing else (no tables, no
-- lookup function: auth_query uses `postgres`). Nothing may connect to it,
-- or CREATE DATABASE ... TEMPLATE foa_seed fails.
SELECT NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'foa_seed') AS missing \gset
\if :missing
  CREATE DATABASE foa_seed OWNER nonprod_migrator;
\endif
ALTER DATABASE foa_seed OWNER TO nonprod_migrator;
-- Open it just long enough to (re)apply the privileges.
ALTER DATABASE foa_seed IS_TEMPLATE false ALLOW_CONNECTIONS true;
\connect foa_seed
\ir nonprod-privileges.sql
\connect postgres
SET client_min_messages = warning;
ALTER DATABASE foa_seed IS_TEMPLATE true ALLOW_CONNECTIONS false;

-- foa_staging ------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'foa_staging') AS missing \gset
\if :missing
  CREATE DATABASE foa_staging TEMPLATE foa_seed OWNER nonprod_migrator;
\endif
ALTER DATABASE foa_staging OWNER TO nonprod_migrator;
REVOKE ALL ON DATABASE foa_staging FROM PUBLIC;
GRANT CONNECT ON DATABASE foa_staging TO nonprod_app;
-- Re-applied so changes reach a staging database that predates them.
\connect foa_staging
\ir nonprod-privileges.sql
