-- #125: event attendance service messages, not outbound campaigns.
INSERT INTO "message_template" ("key","channel","subject","body","variables","updated_at") VALUES
 ('event.registration_created','email','{{event.registrationStatus}}: {{event.title}}', E'Hello {{recipient.name}},\n\nYour event registration is {{event.registrationStatus}} for {{event.title}}. It starts on {{event.start}} at {{event.place}}. Please use your FOA dashboard for current registration details.\n\nFriends of Animals','["recipient.name","event.title","event.registrationStatus","event.start","event.place"]',now()),
 ('event.registration_created','in_app','{{event.registrationStatus}}: {{event.title}}','Your registration for {{event.title}} is {{event.registrationStatus}}. It starts on {{event.start}} at {{event.place}}. Check your events dashboard.','["event.title","event.registrationStatus","event.start","event.place"]',now()),
 ('event.waitlist_promoted','email','A place is available: {{event.title}}', E'Hello {{recipient.name}},\n\nA place has opened and your registration for {{event.title}} is now confirmed. The event starts on {{event.start}} at {{event.place}}.\n\nFriends of Animals','["recipient.name","event.title","event.start","event.place"]',now()),
 ('event.waitlist_promoted','in_app','A place is available: {{event.title}}','Your registration is now confirmed. {{event.title}} starts on {{event.start}} at {{event.place}}.','["event.title","event.start","event.place"]',now()),
 ('event.registration_cancelled','email','Registration cancelled: {{event.title}}','Your registration for {{event.title}} has been cancelled. You can register again while places are available.','["event.title"]',now()),
 ('event.registration_cancelled','in_app','Registration cancelled: {{event.title}}','Your registration for {{event.title}} has been cancelled.','["event.title"]',now()),
 ('event.changed','email','Change: {{event.title}}','The {{event.changes}} for {{event.title}} changed. Current start: {{event.start}}, place: {{event.place}}. Please check the event page for details.','["event.title","event.changes","event.start","event.place"]',now()),
 ('event.changed','in_app','Change: {{event.title}}','The {{event.changes}} changed. {{event.title}} starts on {{event.start}} at {{event.place}}.','["event.title","event.changes","event.start","event.place"]',now()),
 ('event.cancelled','email','Event cancelled: {{event.title}}','We are sorry that {{event.title}} has been cancelled. Please check the event page for details.','["event.title"]',now()),
 ('event.cancelled','in_app','Event cancelled: {{event.title}}','{{event.title}} has been cancelled.','["event.title"]',now()),
 ('reminders.event_starts','email','Reminder: {{event.title}}','{{event.title}} starts on {{reminder.deadline}} at {{event.place}}. Please check your current registration and event details on the FOA website.','["event.title","reminder.deadline","event.place"]',now()),
 ('reminders.event_starts','in_app','Reminder: {{event.title}}','{{event.title}} starts on {{reminder.deadline}} at {{event.place}}.','["event.title","reminder.deadline","event.place"]',now())
ON CONFLICT ("key","channel","locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type","audience","template_key","channels","required_by_law","created_at") VALUES
 ('event.registration_created','event_registrants','event.registration_created','{email,in_app}',false,now()),
 ('event.waitlist_promoted','event_registrants','event.waitlist_promoted','{email,in_app}',false,now()),
 ('event.registration_cancelled','event_registrants','event.registration_cancelled','{email,in_app}',false,now()),
 ('event.changed','event_registrants','event.changed','{email,in_app}',false,now()),
 ('event.cancelled','event_registrants','event.cancelled','{email,in_app}',false,now()),
 ('reminder.due','event_reminder_recipients','reminders.event_starts','{email,in_app}',false,now())
ON CONFLICT ("event_type","audience","template_key") DO NOTHING;
