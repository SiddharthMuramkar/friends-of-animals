-- Custom SQL migration file, put your code below! --
-- #85: an entry's messages, to the adult whose registration it is or the
-- child's guardians (a teen with an own login gets the in-app copy only):
-- entry.received once its first file passes the checks, and a notice when
-- an upload didn't pass the virus check or couldn't be opened. Guardian
-- notices identify the entry by code and competition. Each notice
-- references the upload attempt. Like #69's defaults,
-- these are migration data. Staff can edit the wording later. FOA
-- approves the copy (HR-36). Email and in-app only: SMS waits for registered
-- DLT templates (HR-14).
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('entry.received', 'email', 'Entry {{entry.code}} received for {{competition.name}}',
   E'Hello {{recipient.name}},\n\nWe have received "{{entry.title}}", the entry by {{participant.name}} for {{competition.name}}. Its Entry ID is {{entry.code}}. The upload reference is {{entry.uploadReference}}.\n\nYou can replace the picture until submissions close. Please quote the Entry ID if you contact us about it.\n\nFriends of Animals',
   '["recipient.name", "entry.title", "participant.name", "competition.name", "entry.code", "entry.uploadReference"]', now()),
  ('entry.received', 'in_app', 'Entry {{entry.code}} received for {{competition.name}}',
   E'We have received "{{entry.title}}" for entry {{entry.code}}. The upload reference is {{entry.uploadReference}}. You can replace the picture until submissions close.',
   '["entry.code", "competition.name", "entry.title", "entry.uploadReference"]', now()),
  ('entry.file_rejected', 'email', 'We couldn''t accept the file for {{entry.code}}',
   E'Hello {{recipient.name}},\n\nThe file with upload reference {{entry.uploadReference}} for entry {{entry.code}} in {{competition.name}} didn''t pass our virus check and was rejected.\n\nIf the entry already had a picture, it stays as it was. If you still need to replace this file, upload a clean copy before submissions close.\n\nFriends of Animals',
   '["recipient.name", "competition.name", "entry.code", "entry.uploadReference"]', now()),
  ('entry.file_rejected', 'in_app', 'We couldn''t accept the file for {{entry.code}}',
   E'The file with upload reference {{entry.uploadReference}} for entry {{entry.code}} didn''t pass our virus check. If you still need to replace it, upload a clean copy before submissions close.',
   '["entry.code", "entry.uploadReference"]', now()),
  ('entry.processing_failed', 'email', 'We couldn''t open the file for {{entry.code}}',
   E'Hello {{recipient.name}},\n\nWe couldn''t open the file with upload reference {{entry.uploadReference}} for entry {{entry.code}} in {{competition.name}}. It may be damaged or use an unsupported image format.\n\nIf the entry already had a picture, it stays as it was. If you still need to replace this file, try again before submissions close.\n\nFriends of Animals',
   '["recipient.name", "competition.name", "entry.code", "entry.uploadReference"]', now()),
  ('entry.processing_failed', 'in_app', 'We couldn''t open the file for {{entry.code}}',
   E'We couldn''t open the file with upload reference {{entry.uploadReference}} for entry {{entry.code}}. If you still need to replace it, try again before submissions close.',
   '["entry.code", "entry.uploadReference"]', now()),
  ('entry.received.guardian', 'email', 'Entry {{entry.code}} received for {{competition.name}}',
   E'We have received entry {{entry.code}} for {{competition.name}}. The upload reference is {{entry.uploadReference}}.\n\nYou can replace the picture until submissions close. Please quote the Entry ID if you contact us about it.\n\nFriends of Animals',
   '["entry.code", "competition.name", "entry.uploadReference"]', now()),
  ('entry.received.guardian', 'in_app', 'Entry {{entry.code}} received for {{competition.name}}',
   E'We have received entry {{entry.code}} for {{competition.name}}. The upload reference is {{entry.uploadReference}}. You can replace the picture until submissions close.',
   '["entry.code", "competition.name", "entry.uploadReference"]', now()),
  ('entry.file_rejected.guardian', 'email', 'We couldn''t accept the file for {{entry.code}}',
   E'The file with upload reference {{entry.uploadReference}} for entry {{entry.code}} in {{competition.name}} didn''t pass our virus check and was rejected.\n\nIf the entry already had a picture, it stays as it was. If you still need to replace this file, upload a clean copy before submissions close.\n\nFriends of Animals',
   '["entry.code", "competition.name", "entry.uploadReference"]', now()),
  ('entry.file_rejected.guardian', 'in_app', 'We couldn''t accept the file for {{entry.code}}',
   E'The file with upload reference {{entry.uploadReference}} for entry {{entry.code}} in {{competition.name}} didn''t pass our virus check. If you still need to replace it, upload a clean copy before submissions close.',
   '["entry.code", "competition.name", "entry.uploadReference"]', now()),
  ('entry.processing_failed.guardian', 'email', 'We couldn''t open the file for {{entry.code}}',
   E'We couldn''t open the file with upload reference {{entry.uploadReference}} for entry {{entry.code}} in {{competition.name}}. It may be damaged or use an unsupported image format.\n\nIf the entry already had a picture, it stays as it was. If you still need to replace this file, try again before submissions close.\n\nFriends of Animals',
   '["entry.code", "competition.name", "entry.uploadReference"]', now()),
  ('entry.processing_failed.guardian', 'in_app', 'We couldn''t open the file for {{entry.code}}',
   E'We couldn''t open the file with upload reference {{entry.uploadReference}} for entry {{entry.code}} in {{competition.name}}. If you still need to replace it, try again before submissions close.',
   '["entry.code", "competition.name", "entry.uploadReference"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('entry.submitted', 'registration_owner', 'entry.received', '{email,in_app}', false, now()),
  ('entry.submitted', 'guardian_of_participant', 'entry.received.guardian', '{email,in_app}', false, now()),
  ('entry.file_rejected', 'registration_owner', 'entry.file_rejected', '{email,in_app}', false, now()),
  ('entry.file_rejected', 'guardian_of_participant', 'entry.file_rejected.guardian', '{email,in_app}', false, now()),
  ('entry.file_failed', 'registration_owner', 'entry.processing_failed', '{email,in_app}', false, now()),
  ('entry.file_failed', 'guardian_of_participant', 'entry.processing_failed.guardian', '{email,in_app}', false, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
