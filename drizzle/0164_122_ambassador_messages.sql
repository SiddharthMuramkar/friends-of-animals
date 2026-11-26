-- Private service notices; only in-app routes use the encrypted decline reason.
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('ambassador.application_received', 'email', 'Your FOA Ambassador application was received', 'We will let you know when our community team reviews your application.', '[]', now()),
  ('ambassador.application_received', 'in_app', 'Your FOA Ambassador application was received', 'We will let you know when our community team reviews your application.', '[]', now()),
  ('ambassador.application_to_review', 'email', 'An FOA Ambassador application is waiting', 'Review it in the community team dashboard.', '[]', now()),
  ('ambassador.application_to_review', 'in_app', 'An FOA Ambassador application is waiting', 'Review it in the community team dashboard.', '[]', now()),
  ('ambassador.application_approved', 'email', 'Your FOA Ambassador application is approved', 'Welcome! Your Ambassador milestone appears on your timeline.', '[]', now()),
  ('ambassador.application_approved', 'in_app', 'Your FOA Ambassador application is approved', 'Welcome! Your Ambassador milestone appears on your timeline.', '[]', now()),
  ('ambassador.application_declined', 'email', 'Your FOA Ambassador application was reviewed', 'Sign in to see the decision on your dashboard.', '[]', now()),
  ('ambassador.application_declined', 'in_app', 'Your FOA Ambassador application was declined', 'Reason: {{decline.reason}}', '["decline.reason"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('ambassador.application_submitted', 'ambassador_applicant', 'ambassador.application_received', '{in_app}', false, now()),
  ('ambassador.application_submitted', 'ambassador_reviewers', 'ambassador.application_to_review', '{in_app}', false, now()),
  ('ambassador.application_approved', 'ambassador_applicant', 'ambassador.application_approved', '{in_app}', false, now()),
  ('ambassador.application_declined', 'ambassador_applicant', 'ambassador.application_declined', '{in_app}', false, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
