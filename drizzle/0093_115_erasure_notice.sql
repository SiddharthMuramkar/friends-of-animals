-- Custom SQL migration file, put your code below! --
-- #115b: the notice a person gets when an erasure deleted their own
-- account. The account and its inbox are gone by the time it is sent, so
-- no route row can reach them: the erasure job emails the address it read
-- before deleting it, with this template, once. Staff edit the wording
-- afterwards; FOA's counsel approves the copy (HR-30, HR-50). Its in-app
-- wording exists because every template has one; it is never shown.
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('privacy_request.erased', 'email', 'Your data has been erased: {{request.reference}}',
   E'Hello {{recipient.name}},\n\nWe have carried out your request {{request.reference}} for {{request.type}}. Your Friends of Animals account has been deleted, with the records we no longer need.\n\nThe law makes us keep some records for a while, such as proof of what you consented to and records of payments. We keep only what the law needs, and delete it when that time ends.\n\nIf you have a question, write to us through the contact page on our website.\n\nFriends of Animals',
   '["recipient.name", "request.reference", "request.type"]', now()),
  ('privacy_request.erased', 'in_app', 'Your data has been erased',
   E'We have carried out your request {{request.reference}} for {{request.type}}.',
   '["request.reference", "request.type"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
