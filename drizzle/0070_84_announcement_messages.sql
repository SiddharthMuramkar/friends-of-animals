-- Custom SQL migration file, put your code below! --
-- Install the two routes used by the single announcement handler.
-- The defaults come from messages/en-IN/adminAnnouncements.json.
-- The migrated copy is verified in announcements-migrations.test.ts.
-- Staff can edit each template version in Notifications.
-- SMS requires a DLT template ID before the port can send it.
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('announcements.announcement', 'email', '{{competition.name}}: {{announcement.subject}}',
   E'Hello {{recipient.name}},\n\nThere is news about {{competition.name}}.\n\n{{announcement.body}}\n\nFriends of Animals',
   '["recipient.name", "competition.name", "announcement.subject", "announcement.body"]', now()),
  ('announcements.announcement', 'in_app', '{{competition.name}}: {{announcement.subject}}',
   E'{{announcement.body}}',
   '["competition.name", "announcement.subject", "announcement.body"]', now()),
  ('announcements.announcement', 'sms', NULL,
   E'Friends of Animals: news about {{competition.name}}, "{{announcement.subject}}". For details, visit friendsofanimals.dev/contact.',
   '["competition.name", "announcement.subject"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('competition.announcement_sent', 'announcement_registrants', 'announcements.announcement', '{email,sms,in_app}', false, now()),
  ('competition.announcement_sent', 'announcement_contacts', 'announcements.announcement', '{email,sms}', false, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
