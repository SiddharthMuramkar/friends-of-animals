-- Custom SQL migration file, put your code below! --
-- #123: the messages a volunteer application sends. A 14- to 17-year-old's
-- verified guardians are asked to approve; the applicant hears that it
-- reached the community team, and what was decided; the community team
-- hears that one is waiting. Messages about a teen go to their guardians,
-- and the teen gets an inbox copy only (`volunteer_applicant` limits them
-- to it). Data, not seed, like #69's defaults: production is never seeded.
-- Staff edit the wording afterwards (new versions); FOA approves the copy
-- (HR-56). Email and in-app only: SMS waits for registered DLT templates
-- (HR-14). Nothing sends in production until applications open there
-- (setting volunteers.applicationsOpen, HR-55).
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('volunteer.guardian_approval_request', 'email', '{{applicant.name}} has applied to volunteer with Friends of Animals',
   E'Hello {{recipient.name}},\n\n{{applicant.name}} has applied to volunteer with Friends of Animals. Volunteers under 18 need their parent or guardian to approve before our community team reads their application.\n\nPlease sign in, open {{applicant.name}}''s page under My children, and approve or decline it. You can withdraw it there too.\n\nFriends of Animals',
   '["recipient.name", "applicant.name"]', now()),
  ('volunteer.guardian_approval_request', 'in_app', '{{applicant.name}} has applied to volunteer',
   E'Approve or decline the application on {{applicant.name}}''s page under My children.',
   '["applicant.name"]', now()),
  ('volunteer.application_received', 'email', 'We have your application to volunteer',
   E'Hello {{recipient.name}},\n\nThank you for applying to volunteer with Friends of Animals. Our community team will read your application and tell you what they decide.\n\nYou can follow it, or withdraw it, from your dashboard.\n\nFriends of Animals',
   '["recipient.name"]', now()),
  ('volunteer.application_received', 'in_app', 'Your application to volunteer is with our community team',
   E'We will tell you here when they have decided.',
   '[]', now()),
  ('volunteer.application_to_review', 'email', 'A volunteer application is waiting: {{applicant.name}}',
   E'Hello {{recipient.name}},\n\n{{applicant.name}} has applied to volunteer. Review the application under Volunteer applications in the admin area.\n\nFriends of Animals',
   '["recipient.name", "applicant.name"]', now()),
  ('volunteer.application_to_review', 'in_app', 'A volunteer application is waiting: {{applicant.name}}',
   E'Review it under Volunteer applications in the admin area.',
   '["applicant.name"]', now()),
  ('volunteer.application_approved', 'email', 'Welcome to the Friends of Animals volunteers',
   E'Hello {{recipient.name}},\n\nYour application to volunteer is approved. Welcome! Our community team will be in touch about what you will do first.\n\nFriends of Animals',
   '["recipient.name"]', now()),
  ('volunteer.application_approved', 'in_app', 'Your application to volunteer is approved',
   E'Welcome! Our community team will be in touch about what you will do first.',
   '[]', now()),
  ('volunteer.application_approved.guardian', 'email', '{{applicant.name}} is now a Friends of Animals volunteer',
   E'Hello {{recipient.name}},\n\nOur community team has approved {{applicant.name}}''s application to volunteer, which you approved. We will write to you about anything {{applicant.name}} is asked to do.\n\nFriends of Animals',
   '["recipient.name", "applicant.name"]', now()),
  ('volunteer.application_approved.guardian', 'in_app', '{{applicant.name}}''s application to volunteer is approved',
   E'Our community team approved it. We will write to you about anything {{applicant.name}} is asked to do.',
   '["applicant.name"]', now()),
  ('volunteer.application_declined', 'email', 'Your application to volunteer',
   E'Hello {{recipient.name}},\n\nThank you for applying to volunteer with Friends of Animals. We are sorry: our community team can''t take your application further this time.\n\nWhy: {{decline.reason}}\n\nYou are welcome to apply again later from your dashboard.\n\nFriends of Animals',
   '["recipient.name", "decline.reason"]', now()),
  ('volunteer.application_declined', 'in_app', 'Your application to volunteer was declined',
   E'Why: {{decline.reason}}',
   '["decline.reason"]', now()),
  ('volunteer.application_declined.guardian', 'email', '{{applicant.name}}''s application to volunteer',
   E'Hello {{recipient.name}},\n\nWe are sorry: our community team can''t take {{applicant.name}}''s application to volunteer further this time.\n\nWhy: {{decline.reason}}\n\n{{applicant.name}} is welcome to apply again later.\n\nFriends of Animals',
   '["recipient.name", "applicant.name", "decline.reason"]', now()),
  ('volunteer.application_declined.guardian', 'in_app', '{{applicant.name}}''s application to volunteer was declined',
   E'Why: {{decline.reason}}',
   '["applicant.name", "decline.reason"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('volunteer.guardian_approval_requested', 'volunteer_guardians', 'volunteer.guardian_approval_request', '{email,in_app}', false, now()),
  ('volunteer.application_submitted', 'volunteer_applicant', 'volunteer.application_received', '{email,in_app}', false, now()),
  ('volunteer.application_submitted', 'community_managers', 'volunteer.application_to_review', '{in_app}', false, now()),
  ('volunteer.application_approved', 'volunteer_applicant', 'volunteer.application_approved', '{email,in_app}', false, now()),
  ('volunteer.application_approved', 'volunteer_guardians', 'volunteer.application_approved.guardian', '{email,in_app}', false, now()),
  ('volunteer.application_declined', 'volunteer_applicant', 'volunteer.application_declined', '{email,in_app}', false, now()),
  ('volunteer.application_declined', 'volunteer_guardians', 'volunteer.application_declined.guardian', '{email,in_app}', false, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
