-- Custom SQL migration file, put your code below! --
-- #87: on the school route a coordinator submits each student's entry, and
-- the student's family contact (a minor's guardian, or the adult student,
-- kept on the participant profile, not a user) is told it was received once
-- its first file passes the checks. Like the registration confirmation
-- (#77), the route's audience `family_contact` holds no user: the entries
-- module's own handler (entries.send_family_receipt) reads this route and
-- emails the decrypted address while the route is enabled with email. The
-- in-app wording exists for the catalogue; nobody has an inbox here. FOA
-- approves the copy (HR-36). Email only: SMS waits for registered DLT
-- templates (HR-14).
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('entry.received.family', 'email', 'Entry {{entry.code}} received for {{competition.name}}',
   E'Hello {{recipient.name}},\n\n{{institution.name}} has submitted the entry by {{participant.name}} for {{competition.name}}, and we have received it. Its Entry ID is {{entry.code}}. The upload reference is {{entry.uploadReference}}.\n\nThe school can replace the picture until submissions close. Please quote the Entry ID if you contact us about it.\n\nFriends of Animals',
   '["recipient.name", "institution.name", "participant.name", "competition.name", "entry.code", "entry.uploadReference"]', now()),
  ('entry.received.family', 'in_app', 'Entry {{entry.code}} received for {{competition.name}}',
   E'{{institution.name}} has submitted entry {{entry.code}} for {{competition.name}}, and we have received it. The upload reference is {{entry.uploadReference}}.',
   '["institution.name", "entry.code", "competition.name", "entry.uploadReference"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('entry.submitted', 'family_contact', 'entry.received.family', '{email}', false, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
