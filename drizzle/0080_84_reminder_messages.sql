-- Custom SQL migration file, put your code below! ---- #84: the first reminder, entry_submission_due, to whoever still owes an
-- entry when it runs: an adult who entered, a minor's guardians, or a
-- school's coordinators. One template for all of them, naming no child
-- and no student. Routes on reminder.due: accounts get email, SMS and an
-- inbox item; roster contacts without an account get email and SMS. Like
-- #69's defaults, these are migration data; staff edit the wording at
-- /admin/templates and FOA approves the copy (HR-36). SMS needs a DLT
-- template id before the port sends it (HR-14). Later reminders (#90, #93,
-- #125) add their own template and two routes the same way.
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('reminders.entry_submission_due', 'email', 'Reminder: submissions for {{competition.name}} close on {{reminder.deadline}}',
   E'Hello {{recipient.name}},\n\nSubmissions for {{competition.name}} close on {{reminder.deadline}}, and we haven''t received every entry you are responsible for yet.\n\nPlease sign in to Friends of Animals and upload the missing work before the deadline. An upload that is still being checked counts as received.\n\nFriends of Animals',
   '["recipient.name", "competition.name", "reminder.deadline"]', now()),
  ('reminders.entry_submission_due', 'in_app', 'Submissions for {{competition.name}} close soon',
   E'Submissions for {{competition.name}} close on {{reminder.deadline}}, and we haven''t received every entry you are responsible for yet. Please upload the missing work before the deadline.',
   '["competition.name", "reminder.deadline"]', now()),
  ('reminders.entry_submission_due', 'sms', NULL,
   E'Friends of Animals: submissions for {{competition.name}} close on {{reminder.deadline}}. Some entries you are responsible for are still missing. Please sign in to upload them.',
   '["competition.name", "reminder.deadline"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('reminder.due', 'reminder_registrants', 'reminders.entry_submission_due', '{email,sms,in_app}', false, now()),
  ('reminder.due', 'reminder_contacts', 'reminders.entry_submission_due', '{email,sms}', false, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
