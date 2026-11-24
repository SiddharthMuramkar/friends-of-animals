ALTER TABLE "entry_file" ADD COLUMN "essay_body" jsonb;--> statement-breakpoint
ALTER TABLE "entry_file" ADD COLUMN "word_count" integer;--> statement-breakpoint
ALTER TABLE "entry_file" ADD CONSTRAINT "entry_file_essay_matches_kind" CHECK (("entry_file"."kind" = 'text') = ("entry_file"."essay_body" IS NOT NULL) AND ("entry_file"."kind" = 'text') = ("entry_file"."word_count" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "entry_file" ADD CONSTRAINT "entry_file_word_count_positive" CHECK ("entry_file"."word_count" IS NULL OR "entry_file"."word_count" > 0);