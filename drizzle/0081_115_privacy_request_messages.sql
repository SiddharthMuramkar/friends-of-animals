-- Custom SQL migration file, put your code below! --
-- #115: the messages a privacy rights request sends. Data, not seed:
-- production is never seeded, and answering a rights request is a legal
-- duty there. Staff edit the wording afterwards (new versions); FOA's
-- counsel approves the copy (HR-30, HR-50). Each route is required by law,
-- so a requester who chose no optional messages still hears about their
-- request, and the grievance officers about their queue.
--
-- A message names the request by its reference, its kind and its due
-- date: never what the requester wrote, a refusal's reason or whose data
-- it is. The requester reads those on the request's page after signing in.
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('privacy_request.received', 'email', 'We have your privacy request {{request.reference}}',
   E'Hello {{recipient.name}},\n\nWe have your request for {{request.type}}. Its reference is {{request.reference}}.\n\nFriends of Animals'' grievance officer will answer by {{request.dueDate}}. You can follow it, or cancel it before work starts, at /dashboard/privacy after signing in.\n\nFriends of Animals',
   '["recipient.name", "request.type", "request.reference", "request.dueDate"]', now()),
  ('privacy_request.received', 'in_app', 'Privacy request {{request.reference}} received',
   E'We have your request for {{request.type}}. We will answer by {{request.dueDate}}. Follow it at /dashboard/privacy.',
   '["request.type", "request.reference", "request.dueDate"]', now()),
  ('privacy_request.new', 'email', 'New privacy request {{request.reference}}',
   E'Hello {{recipient.name}},\n\nA new privacy request, {{request.reference}}, asks for {{request.type}}. It is due by {{request.dueDate}}.\n\nSign in and open the privacy requests at /admin/privacy/requests to answer it.\n\nFriends of Animals',
   '["recipient.name", "request.reference", "request.type", "request.dueDate"]', now()),
  ('privacy_request.new', 'in_app', 'New privacy request {{request.reference}}',
   E'A new privacy request asks for {{request.type}}, due by {{request.dueDate}}. Open it at /admin/privacy/requests.',
   '["request.reference", "request.type", "request.dueDate"]', now()),
  ('privacy_request.rejected', 'email', 'About your privacy request {{request.reference}}',
   E'Hello {{recipient.name}},\n\nWe can''t carry out your request {{request.reference}} for {{request.type}}. Sign in and open it at /dashboard/privacy to read why.\n\nIf you disagree, you can reply through the contact page on our website, or complain to the Data Protection Board of India.\n\nFriends of Animals',
   '["recipient.name", "request.reference", "request.type"]', now()),
  ('privacy_request.rejected', 'in_app', 'Privacy request {{request.reference}} refused',
   E'We can''t carry out your request for {{request.type}}. Open it at /dashboard/privacy to read why.',
   '["request.reference", "request.type"]', now()),
  ('privacy_request.completed', 'email', 'Your privacy request {{request.reference}} is done',
   E'Hello {{recipient.name}},\n\nWe have finished your request {{request.reference}} for {{request.type}}. Sign in and open it at /dashboard/privacy to see what we did. A copy of your data, if you asked for one, can be downloaded there for a limited time.\n\nFriends of Animals',
   '["recipient.name", "request.reference", "request.type"]', now()),
  ('privacy_request.completed', 'in_app', 'Privacy request {{request.reference}} is done',
   E'We have finished your request for {{request.type}}. Open it at /dashboard/privacy to see what we did.',
   '["request.reference", "request.type"]', now()),
  ('privacy_request.overdue_digest', 'email', 'Overdue privacy requests',
   E'Hello {{recipient.name}},\n\n{{digest.overdue}} privacy requests are past their due date, {{digest.assignedToYou}} of them assigned to you.\n\nOpen the privacy requests at /admin/privacy/requests to answer them.\n\nFriends of Animals',
   '["recipient.name", "digest.overdue", "digest.assignedToYou"]', now()),
  ('privacy_request.overdue_digest', 'in_app', 'Overdue privacy requests',
   E'{{digest.overdue}} privacy requests are past their due date, {{digest.assignedToYou}} of them assigned to you. Open /admin/privacy/requests.',
   '["digest.overdue", "digest.assignedToYou"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('privacy_request.submitted', 'privacy_requester', 'privacy_request.received', '{email,in_app}', true, now()),
  ('privacy_request.submitted', 'grievance_officers', 'privacy_request.new', '{in_app}', true, now()),
  ('privacy_request.rejected', 'privacy_requester', 'privacy_request.rejected', '{email,in_app}', true, now()),
  ('privacy_request.completed', 'privacy_requester', 'privacy_request.completed', '{email,in_app}', true, now()),
  ('privacy_request.overdue_digest', 'grievance_digest', 'privacy_request.overdue_digest', '{in_app}', true, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
