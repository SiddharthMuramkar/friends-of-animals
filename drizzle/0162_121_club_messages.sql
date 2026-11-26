-- #121: private transactional updates; the immutable decision row is loaded at delivery.
INSERT INTO "message_template" ("key","channel","subject","body","variables","updated_at") VALUES
 ('club.decision_recorded','email','FOA club update: {{club.outcome}}','The club application for {{club.name}} has been {{club.outcome}}. Decision note: {{club.reason}}. Please check the FOA clubs dashboard for the current status.','["club.name","club.outcome","club.reason"]',now()),
 ('club.decision_recorded','in_app','FOA club update: {{club.outcome}}','{{club.name}}: {{club.outcome}}. Decision note: {{club.reason}}.','["club.name","club.outcome","club.reason"]',now())
ON CONFLICT ("key","channel","locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type","audience","template_key","channels","required_by_law","created_at") VALUES
 ('club.decision_recorded','club_applicant','club.decision_recorded','{email,in_app}',false,now())
ON CONFLICT ("event_type","audience","template_key") DO NOTHING;
