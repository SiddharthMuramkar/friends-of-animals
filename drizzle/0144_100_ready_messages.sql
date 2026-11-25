-- Custom SQL migration file, put your code below! --
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
 ('certificates.ready', 'email', 'Your certificates are ready', E'Your certificates for {{competition.name}} are ready. Sign in and visit your Certificates dashboard to download them.\n\nFriends of Animals', '["competition.name"]', now()),
 ('certificates.ready', 'in_app', 'Your certificates are ready', 'Your certificates for {{competition.name}} are ready to download from your Certificates dashboard.', '["competition.name"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
 ('certificates.ready','certificate_recipients','certificates.ready','{email,in_app}',false,now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
