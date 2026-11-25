-- #91: confirmed students with no digital entry receive an outcome by
-- registration, not by a fabricated Entry ID. FOA approves copy (HR-36).
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('registration.not_shortlisted.family', 'email', 'School judging finished for {{competition.name}}',
   E'Hello {{recipient.name}},\n\n{{institution.name}} has finished judging {{competition.name}} at school. {{participant.name}} was not on the school''s shortlist for FOA judging this time.\n\nThank you for taking part, and for caring about animals. Please quote registration {{registration.number}} if you contact us.\n\nFriends of Animals',
   '["recipient.name", "institution.name", "competition.name", "participant.name", "registration.number"]', now()),
  ('registration.not_shortlisted.family', 'in_app', 'School judging finished for {{competition.name}}',
   E'{{institution.name}} has finished judging {{competition.name}}. {{participant.name}} was not on the school''s shortlist for FOA judging.',
   '["institution.name", "competition.name", "participant.name"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('registration.not_shortlisted', 'family_contact', 'registration.not_shortlisted.family', '{email}', false, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
