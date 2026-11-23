-- Custom SQL migration file, put your code below! --
-- An in-app notice for the uploader. The coordinator's dashboard provides
-- the reason after its institution-scope check.
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('consent_form_reviewed', 'email', 'A signed consent form needs attention',
   'Open the school registration’s consent dashboard to see the review decision and what to do next.', '[]', now()),
  ('consent_form_reviewed', 'in_app', 'A signed consent form needs attention',
   'Open the school registration’s consent dashboard to see the review decision and what to do next.', '[]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('consent.form_reviewed', 'subject_user', 'consent_form_reviewed', '{in_app}', false, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
