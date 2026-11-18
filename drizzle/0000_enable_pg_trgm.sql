-- Custom SQL migration file, put your code below! --
-- Trigram similarity for search (SPEC §2: Postgres full-text plus pg_trgm).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
