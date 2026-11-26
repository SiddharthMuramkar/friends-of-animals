-- #132: an outbid alert goes only to the displaced bidder (HR-63 copy).
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('auction.bid_outbid', 'email', 'You have been outbid on {{lot.code}}',
    E'Hello {{recipient.name}},\n\nAnother bid has overtaken yours on auction lot {{lot.code}}. Check Auctions for the current price and closing time. You may bid again while the lot remains open.\n\nFriends of Animals',
    '["recipient.name", "lot.code"]', now()),
  ('auction.bid_outbid', 'in_app', 'You have been outbid on {{lot.code}}',
    'Another bid has overtaken yours. Open Auctions to check the current price and closing time.',
    '["lot.code"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('auction.bid_outbid', 'outbid_bidder', 'auction.bid_outbid', '{email,in_app}', false, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
