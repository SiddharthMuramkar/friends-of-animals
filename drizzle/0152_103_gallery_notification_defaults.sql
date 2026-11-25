-- Gallery reports and purge incidents only notify the staff about the queue,
-- never the report text, child's name, storage keys or reporter's contact.
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('gallery.report_alert', 'in_app', 'New gallery report', 'Review a new gallery report at /admin/gallery/reports.', '["recipient.name"]', now()),
  ('gallery.purge_overdue', 'in_app', 'Gallery purge overdue', 'A gallery purge is overdue. Check the gallery purge status.', '["recipient.name"]', now()),
  ('gallery.purge_failed', 'in_app', 'Gallery purge failed', 'A gallery purge has not been confirmed. Check the gallery purge status.', '["recipient.name"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('gallery.reported', 'content_managers', 'gallery.report_alert', '{in_app}', true, now()),
  ('gallery.purge_overdue', 'content_managers', 'gallery.purge_overdue', '{in_app}', true, now()),
  ('gallery.purge_failed', 'content_managers', 'gallery.purge_failed', '{in_app}', true, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
