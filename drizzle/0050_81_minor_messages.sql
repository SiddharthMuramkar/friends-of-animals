-- Custom SQL migration file, put your code below! --
-- #81: a confirmed registration of a guardian's child goes to the child's
-- guardians, worded about the child, instead of `registration_owner`'s
-- "You are registered" (an adult's own). A teen with an own login gets the
-- in-app copy only; a minor with no verified guardian gets nothing
-- (src/server/modules/guardians/participant-audience.ts). Data, not seed,
-- like #69's defaults: production is never seeded. Staff edit the wording
-- afterwards (new versions); FOA approves the copy. Email and in-app only:
-- SMS waits for registered DLT templates (HR-14).
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('registration.confirmed_guardian', 'email', '{{participant.name}} is registered for {{competition.name}}',
   E'Hello {{recipient.name}},\n\n{{participant.name}} is registered for {{competition.name}}. The registration number is {{registration.number}}.\n\nPlease write this number on the back of the artwork, and quote it if you contact us about the competition.\n\nFriends of Animals',
   '["recipient.name", "participant.name", "competition.name", "registration.number"]', now()),
  ('registration.confirmed_guardian', 'in_app', '{{participant.name}} is registered for {{competition.name}}',
   E'The registration number is {{registration.number}}.',
   '["participant.name", "competition.name", "registration.number"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('registration.confirmed', 'guardian_of_participant', 'registration.confirmed_guardian', '{email,in_app}', false, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
