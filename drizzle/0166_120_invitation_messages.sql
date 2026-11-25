-- Optional post-competition invitations, authenticated dashboard only.
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('competition_invitations.invitation', 'email', 'Stay involved with Friends of Animals', E'Thank you for taking part in an FOA competition. You are invited to stay involved in our community, volunteering, clubs, campaigns and events. Explore these optional opportunities from your signed-in account: {{invitation.link}}\n\nFriends of Animals', '["invitation.link"]', now()),
  ('competition_invitations.invitation', 'in_app', 'Stay involved with Friends of Animals', 'Explore optional opportunities to join the community, volunteer, start a club or attend events and campaigns: {{invitation.link}}', '["invitation.link"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('competition_invitation.due', 'competition_invitation', 'competition_invitations.invitation', '{email,in_app}', false, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
