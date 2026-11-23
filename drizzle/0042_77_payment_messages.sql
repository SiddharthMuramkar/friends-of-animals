-- Custom SQL migration file, put your code below! --
-- #77: the payment receipt for whoever paid an institution's fees, and the
-- confirmation each family gets with its student's registration number.
-- Data, not seed, like #69's defaults: production is never seeded. Staff
-- edit the wording afterwards (new versions); FOA approves the copy. The
-- receipt is not a numbered tax receipt (FY-sequential receipt numbers
-- belong to donations, #106).
--
-- The family contact (a minor's guardian, or the adult student) has no
-- account, so the family_contact audience holds no user and the dispatcher
-- sends nothing on that route. The registration module emails the
-- contact's address itself, with the route's template, while the route is
-- enabled; the confirmation's in-app wording is never shown. Email only:
-- SMS waits for registered DLT templates (HR-14).
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('payment.receipt', 'email', 'Payment received for {{competition.name}}',
   E'Hello {{recipient.name}},\n\nWe received {{payment.amount}} from {{institution.name}} for {{payment.students}} in {{competition.name}}, under registration {{registration.reference}}. The payment reference is {{payment.reference}}.\n\nEach student''s registration is confirmed, and their family has been sent the student''s registration number. Sign in and open the registration to see every number.\n\nKeep this email as your receipt.\n\nFriends of Animals',
   '["recipient.name", "competition.name", "institution.name", "registration.reference", "payment.amount", "payment.students", "payment.reference"]', now()),
  ('payment.receipt', 'in_app', 'Payment received for {{competition.name}}',
   E'We received {{payment.amount}} for {{payment.students}} under registration {{registration.reference}}. Their registrations are confirmed.',
   '["competition.name", "registration.reference", "payment.amount", "payment.students"]', now()),
  ('registration.confirmed', 'email', '{{participant.name}} is registered for {{competition.name}}',
   E'Hello {{recipient.name}},\n\n{{participant.name}} is registered for {{competition.name}} through {{institution.name}}. The registration number is {{registration.number}}.\n\nPlease write this number on the back of the artwork, and quote it if you contact us about the competition.\n\nFriends of Animals',
   '["recipient.name", "participant.name", "competition.name", "institution.name", "registration.number"]', now()),
  ('registration.confirmed', 'in_app', '{{participant.name}} is registered for {{competition.name}}',
   E'The registration number is {{registration.number}}.',
   '["participant.name", "competition.name", "registration.number"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('payment.batch_captured', 'subject_user', 'payment.receipt', '{email,in_app}', true, now()),
  ('registration.confirmed', 'family_contact', 'registration.confirmed', '{email}', false, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
