-- Custom SQL migration file, put your code below! --
-- #88: the notice competition managers get when the schedule can't move a
-- competition yet (a guard refused it, e.g. a discipline has no published
-- rubric when school judging is due). Data, not seed, like #69's defaults:
-- production is never seeded. Staff edit the wording afterwards (new
-- versions); FOA approves the copy (HR-36). Email and in-app only, so
-- there are no SMS rows.
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('competition.transition_blocked', 'email', '{{competition.name}} can''t move to {{transition.to}} yet',
   E'Hello {{recipient.name}},\n\n{{competition.name}} ({{competition.code}}) was due to move to {{transition.to}}, but it can''t move yet. {{transition.reason}}\n\nSign in and open the competition''s rubrics to fix this. It moves on its own once nothing is in the way.\n\nFriends of Animals',
   '["recipient.name", "competition.name", "competition.code", "transition.to", "transition.reason"]', now()),
  ('competition.transition_blocked', 'in_app', '{{competition.name}} can''t move to {{transition.to}} yet',
   E'{{transition.reason}} It moves on its own once nothing is in the way.',
   '["competition.name", "transition.to", "transition.reason"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('competition.transition_blocked', 'competition_managers', 'competition.transition_blocked', '{email,in_app}', false, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
