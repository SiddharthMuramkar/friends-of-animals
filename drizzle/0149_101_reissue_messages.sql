INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
 ('certificate.reissued', 'email', 'Your certificate has been reissued', E'Friends of Animals has corrected and reissued a certificate. The previous certificate number is no longer valid. Sign in and visit your Certificates dashboard for the replacement PDF once it is ready. If your school registered you, your coordinator can provide it.\n\nFriends of Animals', '[]', now()),
 ('certificate.reissued', 'in_app', 'Your certificate has been reissued', 'The previous certificate number is no longer valid. Visit your Certificates dashboard for the corrected certificate.', '[]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
 ('certificate.reissued','certificate_reissued_recipients','certificate.reissued','{email,in_app}',false,now()),
 ('certificate.reissued','family_contact','certificate.reissued','{email}',false,now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
