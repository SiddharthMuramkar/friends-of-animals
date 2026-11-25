-- Custom SQL migration file, put your code below! ---- #129: the file purpose for an adoptable animal's photos, ahead of
-- anything that names it (rule F2): pending migrations run in one
-- transaction, so no DDL or data statement in this unit uses it.
ALTER TYPE "public"."file_asset_purpose" ADD VALUE IF NOT EXISTS 'adoption_photo';
