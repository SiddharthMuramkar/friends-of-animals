INSERT INTO "message_template" ("key","channel","subject","body","variables","updated_at") VALUES
  ('recurring_donation.activated', 'email', 'Your monthly donation is active', 'Thank you for authorising your monthly donation to Friends of Animals. You can cancel anytime from your donations dashboard.', '[]', now()),
  ('recurring_donation.activated', 'in_app', 'Your monthly donation is active', 'Thank you for authorising your monthly donation to Friends of Animals. You can cancel anytime from your donations dashboard.', '[]', now()),
  ('recurring_donation.charge_failed', 'email', 'Your monthly donation could not be charged', 'Your monthly charge did not succeed. No donation or receipt has been made for this attempt. The gateway may retry. You can cancel in your donations dashboard.', '[]', now()),
  ('recurring_donation.charge_failed', 'in_app', 'Your monthly donation could not be charged', 'Your monthly charge did not succeed. No donation or receipt has been made for this attempt. The gateway may retry. You can cancel in your donations dashboard.', '[]', now()),
  ('recurring_donation.cancelled', 'email', 'Your monthly donation is cancelled', 'Your recurring donation has been cancelled. Future charges are stopped.', '[]', now()),
  ('recurring_donation.cancelled', 'in_app', 'Your monthly donation is cancelled', 'Your recurring donation has been cancelled. Future charges are stopped.', '[]', now()),
  ('recurring_donation.refunded', 'email', 'Your recurring payment was returned', 'A recurring payment we could not accept has been returned in full. No donation receipt was issued for it.', '[]', now()),
  ('recurring_donation.refunded', 'in_app', 'Your recurring payment was returned', 'A recurring payment we could not accept has been returned in full. No donation receipt was issued for it.', '[]', now())
ON CONFLICT ("key","channel","locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type","audience","template_key","channels","required_by_law","created_at") VALUES
  ('recurring_donation.activated', 'donor', 'recurring_donation.activated', '{email,in_app}', true, now()),
  ('recurring_donation.charge_failed', 'donor', 'recurring_donation.charge_failed', '{email,in_app}', true, now()),
  ('recurring_donation.cancelled', 'donor', 'recurring_donation.cancelled', '{email,in_app}', true, now()),
  ('recurring_donation.refunded', 'donor', 'recurring_donation.refunded', '{email,in_app}', true, now())
ON CONFLICT ("event_type","audience","template_key") DO NOTHING;
