-- Custom SQL migration file, put your code below! --
-- #80: the refund notice for whoever paid the batch (an institution's
-- coordinator or authorised person, or the adult who paid for their own
-- registration), sent once the money is back, and the alert finance gets
-- when the gateway fails a refund, so they retry or close it. Data, not
-- seed, like #69's defaults: production is never seeded. Staff edit the
-- wording afterwards (new versions); FOA approves the copy. Email and
-- in-app only: SMS waits for registered DLT templates (HR-14).
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('refund.processed', 'email', 'Refund of {{refund.amount}} for {{competition.name}}',
   E'Hello {{recipient.name}},\n\nWe have refunded {{refund.amount}} for {{competition.name}}. The refund reference is {{refund.reference}}.\n\nA refund to a card, UPI or bank account usually reaches it within 5 to 7 working days. A refund we pay by hand comes by the method shown in the reference.\n\nKeep this email for your records.\n\nFriends of Animals',
   '["recipient.name", "refund.amount", "competition.name", "refund.reference"]', now()),
  ('refund.processed', 'in_app', 'Refund of {{refund.amount}} for {{competition.name}}',
   E'We have refunded {{refund.amount}}. The reference is {{refund.reference}}.',
   '["refund.amount", "competition.name", "refund.reference"]', now()),
  ('refund.failed', 'email', 'A refund of {{refund.amount}} failed',
   E'Hello {{recipient.name}},\n\nThe payment gateway couldn''t refund {{refund.amount}} for {{competition.name}}. Sign in and open the refunds page to send it again, or close it and pay the money back another way.\n\nFriends of Animals',
   '["recipient.name", "refund.amount", "competition.name"]', now()),
  ('refund.failed', 'in_app', 'A refund of {{refund.amount}} failed',
   E'The payment gateway couldn''t refund {{refund.amount}} for {{competition.name}}. Open the refunds page to send it again or close it.',
   '["refund.amount", "competition.name"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('refund.processed', 'subject_user', 'refund.processed', '{email,in_app}', true, now()),
  ('refund.failed', 'finance_team', 'refund.failed', '{email,in_app}', false, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
