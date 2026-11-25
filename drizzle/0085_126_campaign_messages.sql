-- Custom SQL migration file, put your code below! --
-- The campaign message (#126): the wording around what a community manager
-- writes, on email and in-app. Campaigns don't go by SMS: promotional texts
-- need their own DLT registration (HR-14). The withdrawal notice and link
-- are added by code after this wording (src/server/modules/campaigns/render.ts),
-- so editing it can't remove them. Staff edit each version in Notifications.
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('campaigns.message', 'email', '{{campaign.subject}}',
   E'Hello {{recipient.name}},\n\n{{campaign.body}}\n\nFriends of Animals',
   '["recipient.name", "campaign.subject", "campaign.body"]', now()),
  ('campaigns.message', 'in_app', '{{campaign.subject}}',
   E'{{campaign.body}}',
   '["campaign.subject", "campaign.body"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
-- The campaigns handler plans each recipient itself; this route names the
-- template and its channels, and switching it off stops campaign messages.
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('campaign.message_due', 'campaign_recipient', 'campaigns.message', '{email,in_app}', false, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
