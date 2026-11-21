-- Custom SQL migration file, put your code below! --
-- #69: the default message templates and routes. They are data, not seed:
-- production is never seeded, and the welcome message must go out there.
-- Staff edit the wording afterwards (new versions); counsel confirms which
-- routes are required by law (HR-33) and FOA approves the copy. SMS rows
-- have no DLT template id until DLT registration (HR-14), so they are held
-- back and email and in-app cover for them.
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('identity.welcome', 'email', 'Welcome to Friends of Animals',
   E'Hello {{recipient.name}},\n\nThank you for creating a Friends of Animals account.\n\nTo sign in, enter your email address and we''ll email you a code. There''s no password to remember.\n\nFriends of Animals',
   '["recipient.name"]', now()),
  ('identity.welcome', 'in_app', 'Welcome to Friends of Animals',
   E'Thank you for creating an account, {{recipient.name}}. Messages from Friends of Animals appear here.',
   '["recipient.name"]', now()),
  ('identity.welcome', 'sms', NULL,
   E'Welcome to Friends of Animals, {{recipient.name}}. Thank you for creating an account.',
   '["recipient.name"]', now()),
  ('consent.withdrawal_receipt', 'email', 'You withdrew your consent to messages',
   E'Hello {{recipient.name}},\n\nYou withdrew your consent to messages from Friends of Animals, so we will no longer send you news or updates by email or SMS.\n\nWe will still send the messages the law requires, such as receipts and safeguarding notices.\n\nYou can give your consent again at any time from your account.\n\nFriends of Animals',
   '["recipient.name"]', now()),
  ('consent.withdrawal_receipt', 'in_app', 'Consent to messages withdrawn',
   E'You withdrew your consent to messages. We will only send the messages the law requires.',
   '["recipient.name"]', now()),
  ('consent.withdrawal_receipt', 'sms', NULL,
   E'Friends of Animals: you withdrew your consent to messages. We will only send messages the law requires.',
   '["recipient.name"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('identity.user_signed_up', 'subject_user', 'identity.welcome', '{email,in_app}', false, now()),
  ('consent.withdrawn', 'subject_user', 'consent.withdrawal_receipt', '{email,in_app}', true, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
