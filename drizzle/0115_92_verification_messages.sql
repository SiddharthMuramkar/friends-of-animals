-- #92: the adult, guardian or school coordinator hears FOA's decision.
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('entry.foa_verified', 'email', 'FOA verified entry {{entry.code}}', E'Hello {{recipient.name}},\n\nFOA verified entry {{entry.code}} for {{competition.name}}. It can now go on to the next stages.\n\nFriends of Animals', '["recipient.name", "entry.code", "competition.name"]', now()),
  ('entry.foa_verified', 'in_app', 'FOA verified entry {{entry.code}}', 'FOA verified entry {{entry.code}} for {{competition.name}}. It can now go on to the next stages.', '["entry.code", "competition.name"]', now()),
  ('entry.sent_back', 'email', 'Correction requested for entry {{entry.code}}', E'Hello {{recipient.name}},\n\nFOA has sent entry {{entry.code}} for {{competition.name}} back for correction. {{verification.reason}} Please correct and resubmit by {{verification.deadline}}.\n\nFriends of Animals', '["recipient.name", "entry.code", "competition.name", "verification.reason", "verification.deadline"]', now()),
  ('entry.sent_back', 'in_app', 'Correction requested for entry {{entry.code}}', 'FOA has sent entry {{entry.code}} for {{competition.name}} back for correction. {{verification.reason}} Please correct and resubmit by {{verification.deadline}}.', '["entry.code", "competition.name", "verification.reason", "verification.deadline"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('entry.foa_verified', 'registration_owner', 'entry.foa_verified', '{email,in_app}', false, now()),
  ('entry.foa_verified', 'guardian_of_participant', 'entry.foa_verified', '{email,in_app}', false, now()),
  ('entry.foa_verified', 'institution_coordinators', 'entry.foa_verified', '{email,in_app}', false, now()),
  ('entry.sent_back', 'registration_owner', 'entry.sent_back', '{email,in_app}', false, now()),
  ('entry.sent_back', 'guardian_of_participant', 'entry.sent_back', '{email,in_app}', false, now()),
  ('entry.sent_back', 'institution_coordinators', 'entry.sent_back', '{email,in_app}', false, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
