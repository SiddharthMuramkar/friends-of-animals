-- Custom SQL migration file, put your code below! ---- #86: an entry is now a picture, a video or an essay, so its default
-- messages stop saying "picture" and "image format". Only the wording #85
-- shipped is changed, word for word: a template staff have edited to say
-- something else keeps their words. The version moves with the change.
-- FOA approves the copy (HR-36).
UPDATE "message_template"
   SET "body" = replace("body", 'You can replace the picture until submissions close.', 'You can replace your entry until submissions close.'),
       "version" = "version" + 1,
       "updated_at" = now()
 WHERE "key" IN ('entry.received', 'entry.received.guardian')
   AND "updated_by_user_id" IS NULL
   AND strpos("body", 'You can replace the picture until submissions close.') > 0;
--> statement-breakpoint
UPDATE "message_template"
   SET "body" = replace("body", 'It may be damaged or use an unsupported image format.', 'It may be damaged, in a format we can''t open, or, for a video, longer than the time limit.'),
       "version" = "version" + 1,
       "updated_at" = now()
 WHERE "key" IN ('entry.processing_failed', 'entry.processing_failed.guardian')
   AND "updated_by_user_id" IS NULL
   AND strpos("body", 'It may be damaged or use an unsupported image format.') > 0;
--> statement-breakpoint
UPDATE "message_template"
   SET "body" = replace("body", 'If the entry already had a picture, it stays as it was.', 'If the entry already had a file, it stays as it was.'),
       "version" = "version" + 1,
       "updated_at" = now()
 WHERE "key" IN ('entry.file_rejected', 'entry.file_rejected.guardian', 'entry.processing_failed', 'entry.processing_failed.guardian')
   AND "updated_by_user_id" IS NULL
   AND strpos("body", 'If the entry already had a picture, it stays as it was.') > 0;
