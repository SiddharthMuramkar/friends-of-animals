-- Custom SQL migration file, put your code below! --
-- #127: the messages that tell the person who registered a directory
-- listing what FOA decided, with the reason staff gave. Data, not seed,
-- like #69's defaults: production is never seeded. Staff edit the wording
-- afterwards (new versions); FOA approves the copy (HR-61). The routes ask
-- for email and in-app only, so there are no SMS rows.
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('directory.listing_verified', 'email', '{{listing.name}} is on FOA''s directory',
   E'Hello {{recipient.name}},\n\nFOA has checked and verified {{listing.name}}. It now shows on FOA''s directory, so people looking for help for an animal can find it.\n\nFOA''s note: {{listing.reason}}\n\nYou are now its representative. Sign in and open Your directory listings to keep it up to date.\n\nFriends of Animals',
   '["recipient.name", "listing.name", "listing.reason"]', now()),
  ('directory.listing_verified', 'in_app', '{{listing.name}} is on FOA''s directory',
   E'It now shows on the directory, and you are its representative. FOA''s note: {{listing.reason}}',
   '["listing.name", "listing.reason"]', now()),
  ('directory.listing_rejected', 'email', 'FOA couldn''t accept {{listing.name}}',
   E'Hello {{recipient.name}},\n\nFOA couldn''t accept {{listing.name}} for its directory.\n\nFOA''s note: {{listing.reason}}\n\nYou can register again with corrected details.\n\nFriends of Animals',
   '["recipient.name", "listing.name", "listing.reason"]', now()),
  ('directory.listing_rejected', 'in_app', 'FOA couldn''t accept {{listing.name}}',
   E'FOA''s note: {{listing.reason}} You can register again with corrected details.',
   '["listing.name", "listing.reason"]', now()),
  ('directory.listing_suspended', 'email', '{{listing.name}} is hidden from FOA''s directory',
   E'Hello {{recipient.name}},\n\nFOA has suspended {{listing.name}} for now, so the directory doesn''t show it.\n\nFOA''s note: {{listing.reason}}\n\nContact FOA to find out what happens next.\n\nFriends of Animals',
   '["recipient.name", "listing.name", "listing.reason"]', now()),
  ('directory.listing_suspended', 'in_app', '{{listing.name}} is hidden from FOA''s directory',
   E'FOA''s note: {{listing.reason}} Contact FOA to find out what happens next.',
   '["listing.name", "listing.reason"]', now()),
  ('directory.listing_reinstated', 'email', '{{listing.name}} is back on FOA''s directory',
   E'Hello {{recipient.name}},\n\nFOA has lifted the suspension of {{listing.name}}. The directory shows it again.\n\nFOA''s note: {{listing.reason}}\n\nFriends of Animals',
   '["recipient.name", "listing.name", "listing.reason"]', now()),
  ('directory.listing_reinstated', 'in_app', '{{listing.name}} is back on FOA''s directory',
   E'The directory shows it again. FOA''s note: {{listing.reason}}',
   '["listing.name", "listing.reason"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('directory.listing_verified', 'subject_user', 'directory.listing_verified', '{email,in_app}', false, now()),
  ('directory.listing_rejected', 'subject_user', 'directory.listing_rejected', '{email,in_app}', false, now()),
  ('directory.listing_suspended', 'subject_user', 'directory.listing_suspended', '{email,in_app}', false, now()),
  ('directory.listing_reinstated', 'subject_user', 'directory.listing_reinstated', '{email,in_app}', false, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
