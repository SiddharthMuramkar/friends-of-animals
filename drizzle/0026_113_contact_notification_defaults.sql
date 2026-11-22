-- Custom SQL migration file, put your code below! --
-- #113: the contact form's messages. They are data, not seed: production
-- is never seeded, and every sender is told their message arrived there.
-- Staff edit the wording afterwards (new versions); FOA approves the copy
-- (HR-50). These templates may say only a message's reference and topic,
-- never what its sender wrote: otherwise the form would mail anyone's words
-- to any address, from FOA.
--
-- The sender has no account, so the contact_sender audience holds no user
-- and the dispatcher sends nothing on that route. The contact module emails
-- the sender's address itself, with the route's template, while the route
-- is enabled; the acknowledgement's in-app wording is never shown.
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('contact.acknowledgement', 'email', 'We received your message {{contact.reference}}',
   E'Thank you for writing to Friends of Animals.\n\nWe received your message about {{contact.topic}}. Its reference is {{contact.reference}}: please quote it if you write to us about it again.\n\nThe right team will reply to this address. If you didn''t write to us, you can ignore this email.\n\nFriends of Animals',
   '["contact.reference","contact.topic"]', now()),
  ('contact.acknowledgement', 'in_app', 'We received your message {{contact.reference}}',
   E'We received your message about {{contact.topic}}. Its reference is {{contact.reference}}.',
   '["contact.reference","contact.topic"]', now()),
  ('contact.new_message', 'email', 'New contact message about {{contact.topic}}',
   E'Hello {{recipient.name}},\n\nA message about {{contact.topic}} came in through the contact form. Its reference is {{contact.reference}}.\n\nSign in and open the contact inbox to read it and assign it.\n\nFriends of Animals',
   '["recipient.name","contact.reference","contact.topic"]', now()),
  ('contact.new_message', 'in_app', 'New contact message about {{contact.topic}}',
   E'Message {{contact.reference}} came in through the contact form. Open the contact inbox to read it and assign it.',
   '["recipient.name","contact.reference","contact.topic"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('contact_message.received', 'contact_sender', 'contact.acknowledgement', '{email}', false, now()),
  ('contact_message.received', 'contact_team', 'contact.new_message', '{in_app}', false, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
