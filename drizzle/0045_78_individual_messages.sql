-- Custom SQL migration file, put your code below! --
-- #78: an adult who registers themselves gets their own receipt and
-- confirmation, by route rows to their account, instead of the
-- institution's receipt (worded for a school's students) and the family
-- contact's confirmation (an address on the profile). Data, not seed, like
-- #69's defaults: production is never seeded. Staff edit the wording
-- afterwards (new versions); FOA approves the copy. The receipt is not a
-- numbered tax receipt (FY-sequential receipt numbers belong to donations,
-- #106). Email and in-app only: SMS waits for registered DLT templates
-- (HR-14).
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('payment.receipt_individual', 'email', 'Payment received for {{competition.name}}',
   E'Hello {{recipient.name}},\n\nWe received {{payment.amount}} for your registration for {{competition.name}}. The payment reference is {{payment.reference}}.\n\nYour registration is confirmed. Your registration number is {{registration.number}}, and your FOA Participant ID is {{participant.code}}.\n\nKeep this email as your receipt.\n\nFriends of Animals',
   '["recipient.name", "competition.name", "payment.amount", "payment.reference", "registration.number", "participant.code"]', now()),
  ('payment.receipt_individual', 'in_app', 'Payment received for {{competition.name}}',
   E'We received {{payment.amount}}. Your registration number is {{registration.number}}.',
   '["competition.name", "payment.amount", "registration.number"]', now()),
  ('registration.confirmed_self', 'email', 'You are registered for {{competition.name}}',
   E'Hello {{recipient.name}},\n\nYou are registered for {{competition.name}}. Your registration number is {{registration.number}}.\n\nPlease write this number on the back of your artwork, and quote it if you contact us about the competition.\n\nFriends of Animals',
   '["recipient.name", "competition.name", "registration.number"]', now()),
  ('registration.confirmed_self', 'in_app', 'You are registered for {{competition.name}}',
   E'Your registration number is {{registration.number}}.',
   '["competition.name", "registration.number"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('payment.batch_captured', 'individual_payer', 'payment.receipt_individual', '{email,in_app}', true, now()),
  ('registration.confirmed', 'registration_owner', 'registration.confirmed_self', '{email,in_app}', false, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
