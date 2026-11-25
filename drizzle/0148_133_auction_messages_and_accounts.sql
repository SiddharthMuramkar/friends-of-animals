INSERT INTO ledger_account (id, code, name, kind, is_system, is_active, public_group, created_at, updated_at) VALUES
  (gen_random_uuid(), '2200', 'Creator auction shares payable', 'liability', true, true, null, now(), now()),
  (gen_random_uuid(), '2210', 'Auction payments in review', 'liability', true, true, null, now(), now()),
  (gen_random_uuid(), '4300', 'Auction proceeds', 'income', true, true, 'income', now(), now())
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO message_template (key, channel, subject, body, variables, updated_at) VALUES
  ('auction.offer_opened','email','Your winning bid on {{lot.code}}', E'Hello {{recipient.name}},\n\nYour bid on lot {{lot.code}} has won. Sign in and pay before {{offer.deadline}}: {{offer.link}}.\n\nFriends of Animals', '["recipient.name","lot.code","offer.deadline","offer.link"]',now()),
  ('auction.offer_opened','in_app','Your winning bid on {{lot.code}}','Sign in and pay before {{offer.deadline}}: {{offer.link}}.', '["lot.code","offer.deadline","offer.link"]',now()),
  ('auction.thank_creator','email','Thank you for contributing artwork {{lot.code}}',E'Dear {{recipient.name}},\n\nThe original artwork offered as lot {{lot.code}} has been sold. Thank you for sharing your creativity and helping Friends of Animals nurture kindness toward animals.\n\nFriends of Animals','["recipient.name","lot.code"]',now()),
  ('auction.thank_creator','in_app','Thank you for contributing artwork {{lot.code}}','The original artwork offered as this lot has been sold. Thank you for sharing your creativity and helping Friends of Animals.','["lot.code"]',now()),
  ('auction.thank_school','email','Thank you to your school for artwork {{lot.code}}',E'Dear {{recipient.name}},\n\nAn original artwork from your school, lot {{lot.code}}, has been sold. Thank you to the school and the young artist for supporting kindness toward animals. Please share our thanks with the family privately.\n\nFriends of Animals','["recipient.name","lot.code"]',now()),
  ('auction.thank_school','in_app','Thank you to your school for artwork {{lot.code}}','The artwork has been sold. Please share our thanks with the young artist and family privately.','["lot.code"]',now())
ON CONFLICT (key,channel,locale) DO NOTHING;
--> statement-breakpoint
INSERT INTO message_route (event_type,audience,template_key,channels,required_by_law,created_at) VALUES
  ('auction.offer_opened','auction_winner','auction.offer_opened','{email,in_app}',false,now()),
  ('auction.sale_captured','auction_creator','auction.thank_creator','{email,in_app}',false,now()),
  ('auction.sale_captured','family_contact','auction.thank_creator','{email}',false,now()),
  ('auction.sale_captured','auction_school','auction.thank_school','{email,in_app}',false,now())
ON CONFLICT (event_type,audience,template_key) DO NOTHING;
