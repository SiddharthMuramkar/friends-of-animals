-- Custom SQL migration file, put your code below! ---- #116: the notices a breach sends, to the people it affected and to the
-- authority. Data, not seed: production is never seeded, and these notices
-- are a legal duty there. Staff edit the wording afterwards (new
-- versions); FOA's counsel approves the copy before production use
-- (HR-49, HR-50). Both routes are required by law, so a recipient's choice
-- of no optional email doesn't stop them.
--
-- A notice to an affected person says only whose data was involved (theirs,
-- a child's they look after, or both): never the breach's title, impact or
-- notes, so a shared inbox or a lock screen shows nothing of it. The event
-- gives no other variable, so an edit can't add them either. A minor is
-- never told directly; their guardians are (src/server/modules/breaches/
-- notify.ts plans who).
--
-- The authority is an address, not a user, so the breach_authority audience
-- holds nobody: the breaches module emails the configured address
-- (setting breach.authorityEmail) with this route's template while the
-- route is enabled. Its in-app wording exists because every template has
-- one; it is never sent.
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('breach.principal_notice', 'email', 'About a personal data breach at Friends of Animals',
   E'Hello {{recipient.name}},\n\nWe are writing to tell you about a personal data breach at Friends of Animals that involved {{breach.about}}.\n\nWe are dealing with it and finding out what happened. We will write to you again about what it means for you and anything you can do to protect yourself.\n\nIf you have a question in the meantime, write to us through the contact page on our website.\n\nFriends of Animals',
   '["recipient.name", "breach.about"]', now()),
  ('breach.principal_notice', 'in_app', 'A personal data breach at Friends of Animals',
   E'A personal data breach at Friends of Animals involved {{breach.about}}. We will write to you about what it means for you and anything you can do.',
   '["breach.about"]', now()),
  ('breach.authority_notice', 'email', 'Personal data breach report from Friends of Animals: {{breach.title}}',
   E'Dear Sir or Madam,\n\nFriends of Animals is reporting a personal data breach.\n\nTitle: {{breach.title}}\nFriends of Animals became aware of it: {{breach.awareAt}}\nSeverity: {{breach.severity}}\nPeople affected (estimate): {{breach.affectedCount}}\nChildren affected: {{breach.minorsAffected}}\nPersonal data involved: {{breach.personalDataInvolved}}\n\nOur breach lead will send the full report: what happened, its likely consequences, and what we are doing about it.\n\nFriends of Animals',
   '["breach.title", "breach.awareAt", "breach.severity", "breach.affectedCount", "breach.minorsAffected", "breach.personalDataInvolved"]', now()),
  ('breach.authority_notice', 'in_app', 'Personal data breach report: {{breach.title}}',
   E'Friends of Animals reported a personal data breach it became aware of on {{breach.awareAt}}.',
   '["breach.title", "breach.awareAt"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('breach.principal_notice', 'breach_recipient', 'breach.principal_notice', '{email,in_app}', true, now()),
  ('breach.authority_notice', 'breach_authority', 'breach.authority_notice', '{email}', true, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
