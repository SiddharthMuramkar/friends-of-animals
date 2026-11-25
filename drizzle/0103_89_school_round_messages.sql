-- Custom SQL migration file, put your code below! --
-- #89: when a coordinator finalises the school round, each student's
-- family contact (a minor's guardian, or the adult student, kept on the
-- participant profile, not a user) is told whether the entry was
-- shortlisted for FOA judging. Like the entry receipt (#87), the routes'
-- audience `family_contact` holds no user: the school round module's own
-- handler (school_round.send_family_outcome) reads these routes and emails
-- the decrypted address while a route is enabled with email. The in-app
-- wording exists for the catalogue; nobody has an inbox here. FOA approves
-- the copy (HR-36). Email only: SMS waits for registered DLT templates
-- (HR-14).
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('entry.school_shortlisted.family', 'email', 'Entry {{entry.code}} shortlisted for FOA judging',
   E'Hello {{recipient.name}},\n\n{{institution.name}} has finished judging {{competition.name}} at school, and the entry by {{participant.name}} ({{entry.code}}) is on its shortlist. It now goes on to Friends of Animals for judging. {{entry.positionNote}}\n\nWe will write again when FOA''s judging has news. Please quote the Entry ID if you contact us about it.\n\nFriends of Animals',
   '["recipient.name", "institution.name", "competition.name", "participant.name", "entry.code", "entry.positionNote"]', now()),
  ('entry.school_shortlisted.family', 'in_app', 'Entry {{entry.code}} shortlisted for FOA judging',
   E'{{institution.name}} shortlisted entry {{entry.code}} for {{competition.name}}. It goes on to FOA for judging. {{entry.positionNote}}',
   '["institution.name", "entry.code", "competition.name", "entry.positionNote"]', now()),
  ('entry.not_shortlisted.family', 'email', 'School judging finished for {{competition.name}}',
   E'Hello {{recipient.name}},\n\n{{institution.name}} has finished judging {{competition.name}} at school. The entry by {{participant.name}} ({{entry.code}}) was not on the school''s shortlist for FOA judging this time.\n\nThank you for taking part, and for caring about animals. Please quote the Entry ID if you contact us about it.\n\nFriends of Animals',
   '["recipient.name", "institution.name", "competition.name", "participant.name", "entry.code"]', now()),
  ('entry.not_shortlisted.family', 'in_app', 'School judging finished for {{competition.name}}',
   E'{{institution.name}} has finished judging {{competition.name}}. Entry {{entry.code}} was not on the school''s shortlist for FOA judging.',
   '["institution.name", "competition.name", "entry.code"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('entry.school_shortlisted', 'family_contact', 'entry.school_shortlisted.family', '{email}', false, now()),
  ('entry.not_shortlisted', 'family_contact', 'entry.not_shortlisted.family', '{email}', false, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
