-- pg-prod: the role and database of the self-hosted Umami (#118,
-- docker/analytics.yml). Run by scripts/analytics-bootstrap.sh as `postgres`
-- in the maintenance database, which sets the psql variable `pw` (64 hex
-- characters, from /etc/foa/analytics.env) over stdin. Idempotent.
--
--   umami  owns the database `umami` and runs Umami's own migrations
--          (Prisma). It has nothing in `foa`, and pg_hba.prod.conf lets it
--          in only to `umami`, only from Umami's container (10.112.12.30).
--
-- Not part of bootstrap.sh: Umami is optional, and its password lives in
-- analytics.env rather than a compose secret of the database stack.

\if :{?pw}
\else
  DO $$ BEGIN
    RAISE EXCEPTION 'umami.sql needs the psql variable pw: run analytics-bootstrap.sh';
  END $$;
\endif

-- The password below: keep it out of pg_stat_statements and the server log
-- (see common.sql).
SET pg_stat_statements.track_utility = off;
SET pg_stat_statements.track = none;
SET client_min_messages = warning;
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
SET log_min_duration_statement = -1;

-- Role --------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'umami') AS missing \gset
\if :missing
  CREATE ROLE umami;
\endif

-- Umami's pool (node-postgres) opens up to 10 connections; its migrations run
-- before the server starts. max_connections in prod.conf counts them.
ALTER ROLE umami WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT
  NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 10;
-- The same value on every run, so a rerun changes nothing; a new password in
-- analytics.env applies on the next run.
ALTER ROLE umami WITH PASSWORD :'pw';
\unset pw
-- A stuck transaction must not hold locks on Umami's tables for long.
ALTER ROLE umami SET idle_in_transaction_session_timeout = '60s';

-- Database ------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'umami') AS missing \gset
\if :missing
  CREATE DATABASE umami OWNER umami;
\endif
ALTER DATABASE umami OWNER TO umami;
-- Only its owner connects.
REVOKE ALL ON DATABASE umami FROM PUBLIC;
ALTER DATABASE umami SET timezone TO 'UTC';
