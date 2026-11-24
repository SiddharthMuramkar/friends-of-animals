-- Custom SQL migration file, put your code below! --
-- #80 (80b): when a super admin cancels a competition, each registration's
-- family contact (a minor's guardian, or the adult student) is emailed by
-- the registration module, as the confirmation is; an adult who
-- registered themselves is told on their own account; a guardian's child's
-- guardians are told, as #81 sends every message about a minor; and each
-- institution registration's coordinators and authorised person are told.
-- Each message carries the super admin's reason. Data, not seed, like
-- #69's defaults: production is never seeded. Staff edit the wording
-- afterwards (new versions); FOA approves the copy (HR-34), and counsel
-- the "required by law" list (HR-33). Email and in-app only: SMS waits for
-- registered DLT templates (HR-14).
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('registration.competition_cancelled', 'email', '{{competition.name}} is cancelled',
   E'Hello {{recipient.name}},\n\nWe are sorry: Friends of Animals has cancelled {{competition.name}}, so {{participant.name}}''s registration is cancelled too.\n\nWhy: {{cancellation.reason}}\n\n{{cancellation.fee}}\n\nThank you for caring about animals with us. We hope to see {{participant.name}} at a competition soon.\n\nFriends of Animals',
   '["recipient.name", "competition.name", "participant.name", "cancellation.reason", "cancellation.fee"]', now()),
  ('registration.competition_cancelled', 'in_app', '{{competition.name}} is cancelled',
   E'{{participant.name}}''s registration is cancelled. {{cancellation.fee}}',
   '["competition.name", "participant.name", "cancellation.fee"]', now()),
  ('registration.competition_cancelled_self', 'email', 'Your registration: {{competition.name}} is cancelled',
   E'Hello {{recipient.name}},\n\nWe are sorry: Friends of Animals has cancelled {{competition.name}}, so your registration is cancelled too.\n\nWhy: {{cancellation.reason}}\n\n{{cancellation.fee}}\n\nThank you for caring about animals with us.\n\nFriends of Animals',
   '["recipient.name", "competition.name", "cancellation.reason", "cancellation.fee"]', now()),
  ('registration.competition_cancelled_self', 'in_app', 'Your registration: {{competition.name}} is cancelled',
   E'Your registration is cancelled. {{cancellation.fee}}',
   '["competition.name", "cancellation.fee"]', now()),
  ('institution_registration.competition_cancelled', 'email', '{{competition.name}} is cancelled: registration {{registration.reference}}',
   E'Hello {{recipient.name}},\n\nFriends of Animals has cancelled {{competition.name}}, so registration {{registration.reference}} of {{institution.name}}, and each of its students'' registrations, is cancelled.\n\nWhy: {{cancellation.reason}}\n\nEvery fee paid for it is refunded without anyone asking: a fee paid online goes back to the card, UPI or bank account it came from, and one paid by cheque, bank transfer or cash is paid back by hand. Whoever paid gets an email when each refund is made. Please contact any families who did not provide an email address.\n\nFriends of Animals',
   '["recipient.name", "competition.name", "registration.reference", "institution.name", "cancellation.reason"]', now()),
  ('institution_registration.competition_cancelled', 'in_app', '{{competition.name}} is cancelled: registration {{registration.reference}}',
   E'Registration {{registration.reference}} and its students'' registrations are cancelled. Every fee paid for it is refunded.',
   '["competition.name", "registration.reference"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('registration.competition_cancelled', 'family_contact', 'registration.competition_cancelled', '{email}', true, now()),
  ('registration.competition_cancelled', 'registration_owner', 'registration.competition_cancelled_self', '{email,in_app}', true, now()),
  ('registration.competition_cancelled', 'guardian_of_participant', 'registration.competition_cancelled', '{email,in_app}', true, now()),
  ('institution_registration.competition_cancelled', 'institution_coordinators', 'institution_registration.competition_cancelled', '{email,in_app}', true, now()),
  ('refund.dashboard_processed', 'subject_user', 'refund.processed', '{email,in_app}', true, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
