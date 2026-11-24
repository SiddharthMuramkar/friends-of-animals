-- Custom SQL migration file, put your code below! --
-- #85: the file purpose an entry's picture is uploaded under, ahead of the
-- DDL (rule F2): pending migrations run in one transaction, so nothing in
-- this unit's migrations names it.
ALTER TYPE "public"."file_asset_purpose" ADD VALUE IF NOT EXISTS 'entry_image';
