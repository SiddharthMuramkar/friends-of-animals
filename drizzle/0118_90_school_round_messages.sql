-- Custom SQL migration file, put your code below! --
-- #90: the school round's deadline messages. When the shortlist deadline
-- passes with a round unfinished, its coordinators (and the institution's
-- authorised person) are told it is overdue and that they can still
-- finalise it. Before the deadline, the `school_round_shortlist_due`
-- reminder goes to the coordinators of schools whose round is still open
-- (routes on reminder.due, like 0080_84_reminder_messages). FOA approves
-- the copy (HR-36); SMS needs a DLT template id before the port sends it
-- (HR-14).
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('school_round.overdue', 'email', 'Your school round for {{competition.name}} is overdue',
   E'Hello {{recipient.name}},\n\nThe shortlist deadline for {{competition.name}} was {{round.deadline}}, and the school round of {{institution.name}} isn''t finalised yet. It is now overdue.\n\nNothing is finalised for you: you can still finalise it from your school round page. If it stays unfinished, a competition manager may close it on your school''s behalf with the shortlist you have saved, so that the competition can move on to FOA judging.\n\nFriends of Animals',
   '["recipient.name", "competition.name", "round.deadline", "institution.name"]', now()),
  ('school_round.overdue', 'in_app', 'Your school round for {{competition.name}} is overdue',
   E'The shortlist deadline for {{competition.name}} has passed and the school round of {{institution.name}} isn''t finalised. You can still finalise it; otherwise a competition manager may close it on your behalf with your saved shortlist.',
   '["competition.name", "institution.name"]', now()),
  ('reminders.school_round_shortlist_due', 'email', 'Reminder: school shortlists for {{competition.name}} close on {{reminder.deadline}}',
   E'Hello {{recipient.name}},\n\nThe school round for {{competition.name}} closes on {{reminder.deadline}}, and your school hasn''t finalised its shortlist yet.\n\nPlease sign in to Friends of Animals, record your judging panel and shortlist, and finalise the round before the deadline. A round that isn''t finalised by then becomes overdue.\n\nFriends of Animals',
   '["recipient.name", "competition.name", "reminder.deadline"]', now()),
  ('reminders.school_round_shortlist_due', 'in_app', 'School shortlists for {{competition.name}} close soon',
   E'The school round for {{competition.name}} closes on {{reminder.deadline}}, and your school hasn''t finalised its shortlist yet. Please finalise it before the deadline.',
   '["competition.name", "reminder.deadline"]', now()),
  ('reminders.school_round_shortlist_due', 'sms', NULL,
   E'Friends of Animals: the school round for {{competition.name}} closes on {{reminder.deadline}}. Please sign in and finalise your school''s shortlist.',
   '["competition.name", "reminder.deadline"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('school_round.overdue', 'institution_coordinators', 'school_round.overdue', '{email,in_app}', false, now()),
  ('reminder.due', 'reminder_registrants', 'reminders.school_round_shortlist_due', '{email,sms,in_app}', false, now()),
  ('reminder.due', 'reminder_contacts', 'reminders.school_round_shortlist_due', '{email,sms}', false, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
