-- Custom SQL migration file, put your code below! ---- #86: the file purposes an entry's video and an essay's PDF are uploaded
-- under, ahead of anything that uses them (rule F2): pending migrations run
-- in one transaction, so nothing in this ticket's migrations names them.
ALTER TYPE "public"."file_asset_purpose" ADD VALUE IF NOT EXISTS 'entry_video';--> statement-breakpoint
ALTER TYPE "public"."file_asset_purpose" ADD VALUE IF NOT EXISTS 'entry_document';
