-- Privileges inside a non-production database, for the role pair in the psql
-- variables :migrator and :app (set by nonprod.sql): nonprod_migrator and
-- nonprod_app in foa_seed (previews inherit them from it), staging_migrator
-- and staging_app in foa_staging. Mirrors prod.sql. Included by nonprod.sql
-- while connected to the target database.

SET client_min_messages = warning;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app";

ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator"
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator"
  GRANT USAGE, SELECT ON SEQUENCES TO :"app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator"
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator"
  GRANT EXECUTE ON FUNCTIONS TO :"app";
