-- Custom SQL migration file, put your code below! --
-- #73: the messages that tell an institution's authorised person what FOA
-- decided. Data, not seed, like #69's defaults: production is never seeded.
-- Staff edit the wording afterwards (new versions); FOA approves the copy.
-- The routes ask for email and in-app only, so there are no SMS rows.
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('institution.verified', 'email', '{{institution.name}} is verified',
   E'Hello {{recipient.name}},\n\nFOA has checked and verified {{institution.name}}. Its Institution ID is {{institution.code}}. Use this ID when you talk to FOA about your institution.\n\nYou are now the institution''s admin. Sign in and open Your institution to read FOA''s note.\n\nFriends of Animals',
   '["recipient.name", "institution.name", "institution.code"]', now()),
  ('institution.verified', 'in_app', '{{institution.name}} is verified',
   E'Its Institution ID is {{institution.code}}. You are now the institution''s admin.',
   '["institution.name", "institution.code"]', now()),
  ('institution.rejected', 'email', 'FOA couldn''t accept {{institution.name}}',
   E'Hello {{recipient.name}},\n\nFOA couldn''t accept the registration of {{institution.name}}. Sign in and open Your institution to read FOA''s note. You can register again with corrected details.\n\nFriends of Animals',
   '["recipient.name", "institution.name"]', now()),
  ('institution.rejected', 'in_app', 'FOA couldn''t accept {{institution.name}}',
   E'Read FOA''s note on Your institution. You can register again with corrected details.',
   '["institution.name"]', now()),
  ('institution.suspended', 'email', '{{institution.name}} is suspended',
   E'Hello {{recipient.name}},\n\nFOA has suspended {{institution.name}} for now. Sign in and open Your institution to read FOA''s note, or contact FOA to find out what happens next.\n\nFriends of Animals',
   '["recipient.name", "institution.name"]', now()),
  ('institution.suspended', 'in_app', '{{institution.name}} is suspended',
   E'Read FOA''s note on Your institution, or contact FOA to find out what happens next.',
   '["institution.name"]', now()),
  ('institution.reinstated', 'email', '{{institution.name}} is verified again',
   E'Hello {{recipient.name}},\n\nFOA has lifted the suspension of {{institution.name}}. It keeps its Institution ID, {{institution.code}}, and you are still its admin.\n\nSign in and open Your institution to read FOA''s note.\n\nFriends of Animals',
   '["recipient.name", "institution.name", "institution.code"]', now()),
  ('institution.reinstated', 'in_app', '{{institution.name}} is verified again',
   E'The suspension is lifted. Its Institution ID is still {{institution.code}}.',
   '["institution.name", "institution.code"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('institution.verified', 'subject_user', 'institution.verified', '{email,in_app}', false, now()),
  ('institution.rejected', 'subject_user', 'institution.rejected', '{email,in_app}', false, now()),
  ('institution.suspended', 'subject_user', 'institution.suspended', '{email,in_app}', false, now()),
  ('institution.reinstated', 'subject_user', 'institution.reinstated', '{email,in_app}', false, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
