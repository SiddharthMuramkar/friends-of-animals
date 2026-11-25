-- Generic in-app alerts only. The current verified guardian receives a
-- generic notice without private task or service detail. No direct emails
-- or SMS; FOA's safeguarding copy is pending HR-55/56.
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
 ('volunteer.task_assigned', 'in_app', 'A volunteer task is assigned', 'Open your volunteer tasks to see the assignment.', '[]', now()),
 ('volunteer.hours_approved', 'in_app', 'Volunteer hours approved', 'Open your volunteer service history to see the approved hours.', '[]', now()),
 ('volunteer.hours_rejected', 'in_app', 'Volunteer hours reviewed', 'Open your volunteer service history to see the decision.', '[]', now()),
 ('volunteer.task_assigned.guardian', 'in_app', 'A volunteer task is assigned to your linked child', 'Open their volunteering page for service information.', '[]', now()),
 ('volunteer.hours_approved.guardian', 'in_app', 'Your linked child has approved volunteer hours', 'Open their volunteering page to see the service history.', '[]', now()),
 ('volunteer.hours_rejected.guardian', 'in_app', 'Your linked child’s volunteer hours were reviewed', 'Open their volunteering page to see the decision.', '[]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
 ('volunteer.task_assigned','volunteer_applicant','volunteer.task_assigned','{in_app}',false,now()),
 ('volunteer.hours_approved','volunteer_applicant','volunteer.hours_approved','{in_app}',false,now()),
 ('volunteer.hours_rejected','volunteer_applicant','volunteer.hours_rejected','{in_app}',false,now()),
 ('volunteer.task_assigned','volunteer_guardians','volunteer.task_assigned.guardian','{in_app}',false,now()),
 ('volunteer.hours_approved','volunteer_guardians','volunteer.hours_approved.guardian','{in_app}',false,now()),
 ('volunteer.hours_rejected','volunteer_guardians','volunteer.hours_rejected.guardian','{in_app}',false,now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
