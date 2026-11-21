-- The staging and preview workers' roles on pg-nonprod (#61). Applied as
-- `postgres` by docker/scripts/worker-roles.sh, which passes the passwords
-- in the environment (STAGING_WORKER_PASSWORD, NONPROD_WORKER_PASSWORD),
-- never on a command line. Idempotent.
--
--   staging_worker  worker-staging. DML on `foa_staging` as a member of
--                   staging_app; owns schema `pgboss` there.
--   nonprod_worker  worker-preview. Lists the previews from `postgres`
--                   (catalogs only) and drains each one as a member of
--                   nonprod_app (the previews' default privileges, from
--                   foa_seed). Previews keep CONNECT for PUBLIC, so it needs
--                   no grant per preview. No pg-boss on previews, and no
--                   way into foa_staging.
--
-- pg_hba.nonprod.conf keeps each role to its databases.

-- The passwords below: keep them out of pg_stat_statements and the server
-- log (see common.sql).
SET pg_stat_statements.track_utility = off;
SET pg_stat_statements.track = none;
SET client_min_messages = warning;
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
SET log_min_duration_statement = -1;

\getenv staging_pw STAGING_WORKER_PASSWORD
\getenv nonprod_pw NONPROD_WORKER_PASSWORD
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'staging_worker') AS missing \gset
\if :missing
  CREATE ROLE staging_worker;
\endif
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nonprod_worker') AS missing \gset
\if :missing
  CREATE ROLE nonprod_worker;
\endif
ALTER ROLE staging_worker WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT
  NOREPLICATION NOBYPASSRLS;
ALTER ROLE nonprod_worker WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT
  NOREPLICATION NOBYPASSRLS;
-- The secret files are the truth: re-applied on every run (rotation).
ALTER ROLE staging_worker WITH PASSWORD :'staging_pw';
ALTER ROLE nonprod_worker WITH PASSWORD :'nonprod_pw';
\unset staging_pw
\unset nonprod_pw

-- As foa_worker on pg-prod (workers-prod.sql).
ALTER ROLE staging_worker SET statement_timeout = '60s';
ALTER ROLE staging_worker SET lock_timeout = '10s';
ALTER ROLE staging_worker SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE nonprod_worker SET statement_timeout = '60s';
ALTER ROLE nonprod_worker SET lock_timeout = '10s';
ALTER ROLE nonprod_worker SET idle_in_transaction_session_timeout = '60s';

GRANT staging_app TO staging_worker;
GRANT CONNECT ON DATABASE foa_staging TO staging_worker;

GRANT nonprod_app TO nonprod_worker;
GRANT CONNECT ON DATABASE postgres TO nonprod_worker;
REVOKE ALL ON DATABASE foa_staging FROM nonprod_worker;

\connect foa_staging
SET client_min_messages = warning;
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION staging_worker;
ALTER SCHEMA pgboss OWNER TO staging_worker;
