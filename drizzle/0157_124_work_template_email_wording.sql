-- Template catalogue maintains email/in-app wording pairs. Service routes
-- remain inbox-only, including guardian routes; the work audience also
-- independently limits delivery to the inbox. These counterparts do not
-- introduce any email route.
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at")
SELECT "key", 'email', "subject", "body", "variables", now()
FROM "message_template"
WHERE "channel" = 'in_app' AND "key" IN (
  'volunteer.task_assigned', 'volunteer.hours_approved', 'volunteer.hours_rejected',
  'volunteer.task_assigned.guardian', 'volunteer.hours_approved.guardian', 'volunteer.hours_rejected.guardian'
)
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
