-- Privileges inside a non-production database (foa_seed, foa_staging; previews
-- inherit them from foa_seed). Mirrors prod.sql with nonprod_* roles.
-- Included by nonprod.sql while connected to the target database.

SET client_min_messages = warning;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO nonprod_app;

ALTER DEFAULT PRIVILEGES FOR ROLE nonprod_migrator
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nonprod_app;
ALTER DEFAULT PRIVILEGES FOR ROLE nonprod_migrator
  GRANT USAGE, SELECT ON SEQUENCES TO nonprod_app;
ALTER DEFAULT PRIVILEGES FOR ROLE nonprod_migrator
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE nonprod_migrator
  GRANT EXECUTE ON FUNCTIONS TO nonprod_app;
