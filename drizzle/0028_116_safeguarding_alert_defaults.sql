-- Custom SQL migration file, put your code below! --
-- #116: the alert every safeguarding lead gets when a concern is reported.
-- It is data, not seed: production is never seeded, and leads must hear of
-- a report there. Staff edit the wording afterwards (new versions); FOA
-- approves the copy (HR-50) and the safeguarding process (HR-48).
--
-- The alert says only that a report came in and where to read it: never
-- its category, reference or words, so an email client, a notification on
-- a lock screen or a shared inbox shows nothing of it. It may use only the
-- recipient's name (the event gives no variables), so an edit can't add
-- the report either. Required by law: it goes even to a lead who chose no
-- messages.
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('safeguarding.report_alert', 'email', 'A safeguarding concern was reported',
   E'Hello {{recipient.name}},\n\nSomeone reported a safeguarding concern through the Friends of Animals website.\n\nSign in and open the safeguarding reports at /admin/safeguarding to read it and triage it. This email doesn''t say what was reported, on purpose.\n\nFriends of Animals',
   '["recipient.name"]', now()),
  ('safeguarding.report_alert', 'in_app', 'New safeguarding report',
   E'A safeguarding concern was reported. Open the safeguarding reports at /admin/safeguarding to read it and triage it.',
   '["recipient.name"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('safeguarding.report_submitted', 'safeguarding_leads', 'safeguarding.report_alert', '{email,in_app}', true, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
