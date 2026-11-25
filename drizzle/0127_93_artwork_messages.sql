-- Custom SQL migration file, put your code below! --
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
 ('artwork.requested','email','Please dispatch your artwork {{artwork.code}}', E'Please send the original artwork for entry {{entry.code}}. Label it {{artwork.code}}.\n\n{{artwork.packaging}}\nShipping paid by {{artwork.shipping}}.\nSend to {{artwork.address}}.\nDispatch by {{artwork.deadline}}. Record the courier and tracking number in your artwork dashboard.', '["artwork.code","entry.code","artwork.packaging","artwork.shipping","artwork.address","artwork.deadline"]', now()),
 ('artwork.requested','in_app','Please dispatch your artwork {{artwork.code}}', E'Please send the original work for entry {{entry.code}}. Label it {{artwork.code}}. {{artwork.packaging}} Shipping paid by {{artwork.shipping}}. Send to {{artwork.address}}. Dispatch by {{artwork.deadline}} and record tracking.', '["artwork.code","entry.code","artwork.packaging","artwork.shipping","artwork.address","artwork.deadline"]', now()),
 ('artwork.requested','sms',NULL,'FOA requests artwork {{artwork.code}} by {{artwork.deadline}}. Sign in for packaging and address instructions.', '["artwork.code","artwork.deadline"]',now()),
 ('artwork.received','email','We received your artwork {{artwork.code}}','FOA has received artwork {{artwork.code}} for entry {{entry.code}}. Thank you!', '["artwork.code","entry.code"]', now()),
 ('artwork.received','in_app','Artwork {{artwork.code}} received','FOA has received artwork {{artwork.code}}. Thank you!', '["artwork.code"]', now()),
 ('artwork.received','sms',NULL,'FOA has received artwork {{artwork.code}}. Thank you!', '["artwork.code"]',now()),
 ('reminders.artwork_dispatch_due','email','Reminder: dispatch artwork {{artwork.code}}','Please dispatch your original artwork {{artwork.code}} by {{reminder.deadline}} and record its courier and tracking number in your artwork dashboard.', '["artwork.code","reminder.deadline"]', now()),
 ('reminders.artwork_dispatch_due','in_app','Dispatch artwork {{artwork.code}} soon','Please dispatch artwork {{artwork.code}} by {{reminder.deadline}} and record its tracking.', '["artwork.code","reminder.deadline"]',now()),
 ('reminders.artwork_dispatch_due','sms',NULL,'FOA reminder: dispatch artwork {{artwork.code}} by {{reminder.deadline}} and record tracking.', '["artwork.code","reminder.deadline"]',now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
 ('artwork.requested','artwork_sender','artwork.requested','{email,sms,in_app}',false,now()),
 ('artwork.received','artwork_sender','artwork.received','{email,sms,in_app}',false,now()),
 ('reminder.due','reminder_registrants','reminders.artwork_dispatch_due','{email,sms,in_app}',false,now()),
 ('reminder.due','reminder_contacts','reminders.artwork_dispatch_due','{email,sms}',false,now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
