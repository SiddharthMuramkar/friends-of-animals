-- Feedback invites use email and the account inbox, never SMS or a child's contact.
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('surveys.invitation', 'email', 'Competition feedback', E'Hello {{recipient.name}},\n\nWe would value your feedback on {{survey.title}}. Participation is optional. Answer once using this private link: {{survey.link}}\n\nFriends of Animals', '["recipient.name", "survey.title", "survey.link"]', now()),
  ('surveys.invitation', 'in_app', 'Competition feedback', 'We would value your feedback on {{survey.title}}. Participation is optional. Answer once using this private link: {{survey.link}}', '["survey.title", "survey.link"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('survey.invitation_due', 'survey_invitation', 'surveys.invitation', '{email,in_app}', false, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
