-- Custom SQL migration file, put your code below! --
-- #106: the ledger accounts donations post to, and the donor's messages.
-- Data, not seed, like #105's chart and #69's defaults: production is
-- never seeded. Keep the accounts in sync with SEEDED_ACCOUNTS in the
-- ledger domain; the accountant confirms codes and names (HR-47).
INSERT INTO ledger_account (id, code, name, kind, is_system, public_group, created_at, updated_at)
SELECT id::uuid, code, name, kind::ledger_account_kind, is_system, public_group,
       '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00'
FROM (VALUES
  ('01938a00-0000-7000-8000-000000106001', '2100', 'Foreign contributions to return', 'liability', true, NULL),
  ('01938a00-0000-7000-8000-000000106002', '4200', 'Donations from individuals', 'income', true, 'income'),
  ('01938a00-0000-7000-8000-000000106003', '4210', 'Donations from companies', 'income', true, 'income'),
  ('01938a00-0000-7000-8000-000000106004', '4220', 'CSR donations', 'income', true, 'income')
) AS chart(id, code, name, kind, is_system, public_group)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
-- The donor has no account to send to, or may not: the donations module
-- emails the address the donor gave with these routes' templates while
-- each route is enabled (audience `donor`), and a signed-in donor also
-- gets the in-app wording, which carries no link. A receipt link's token
-- is minted when the message goes, never stored in the outbox. Staff edit
-- the wording afterwards (new versions); FOA approves the copy (HR-50).
-- Email and in-app only: SMS waits for registered DLT templates (HR-14).
INSERT INTO "message_template" ("key", "channel", "subject", "body", "variables", "updated_at") VALUES
  ('donation.thank_you', 'email', 'Thank you for your donation of {{donation.amount}}',
   E'Hello {{recipient.name}},\n\nThank you for giving {{donation.amount}} to Friends of Animals. Your receipt number is {{receipt.number}}.\n\nOpen your receipt here: {{receipt.link}}\n\nThe link works until {{receipt.expiresOn}}. Save or print the receipt before then. If the link has expired, you can ask for a new one on our website with your email address and the receipt number.\n\nFriends of Animals',
   '["recipient.name", "donation.amount", "receipt.number", "receipt.link", "receipt.expiresOn"]', now()),
  ('donation.thank_you', 'in_app', 'Thank you for your donation of {{donation.amount}}',
   E'Your receipt number is {{receipt.number}}. We have emailed you a link to it.',
   '["donation.amount", "receipt.number"]', now()),
  ('donation.receipt_link', 'email', 'Your receipt {{receipt.number}}',
   E'Hello {{recipient.name}},\n\nHere is a new link to your receipt {{receipt.number}} for {{donation.amount}}: {{receipt.link}}\n\nThe link works until {{receipt.expiresOn}}. If you did not ask for it, you can ignore this email.\n\nFriends of Animals',
   '["recipient.name", "receipt.number", "donation.amount", "receipt.link", "receipt.expiresOn"]', now()),
  ('donation.receipt_link', 'in_app', 'Your receipt {{receipt.number}}',
   E'We have emailed you a new link to your receipt {{receipt.number}}.',
   '["receipt.number"]', now()),
  ('donation.refunded', 'email', 'Your donation of {{donation.amount}} was refunded',
   E'Hello {{recipient.name}},\n\nWe have refunded {{refund.amount}} of your donation of {{donation.amount}}. The refund reference is {{refund.reference}}. Its receipt is cancelled.\n\nA refund to a card, UPI or bank account usually reaches it within 5 to 7 working days.\n\nFriends of Animals',
   '["recipient.name", "refund.amount", "donation.amount", "refund.reference"]', now()),
  ('donation.refunded', 'in_app', 'Your donation of {{donation.amount}} was refunded',
   E'We have refunded {{refund.amount}}. The reference is {{refund.reference}}.',
   '["donation.amount", "refund.amount", "refund.reference"]', now()),
  ('donation.foreign_refunded', 'email', 'We have returned your payment of {{refund.amount}}',
   E'Hello {{recipient.name}},\n\nThank you for wanting to support Friends of Animals. Your payment came from a card or account outside India, and the law lets us accept donations only from Indian sources for now, so we have returned all of it. The refund reference is {{refund.reference}}.\n\nA refund to a card usually reaches it within 5 to 7 working days.\n\nFriends of Animals',
   '["recipient.name", "refund.amount", "refund.reference"]', now()),
  ('donation.foreign_refunded', 'in_app', 'We have returned your payment of {{refund.amount}}',
   E'Your payment came from outside India, so we have returned it. The reference is {{refund.reference}}.',
   '["refund.amount", "refund.reference"]', now())
ON CONFLICT ("key", "channel", "locale") DO NOTHING;
--> statement-breakpoint
INSERT INTO "message_route" ("event_type", "audience", "template_key", "channels", "required_by_law", "created_at") VALUES
  ('donation.captured', 'donor', 'donation.thank_you', '{email,in_app}', true, now()),
  ('receipt.link_requested', 'donor', 'donation.receipt_link', '{email,in_app}', true, now()),
  ('donation.refunded', 'donor', 'donation.refunded', '{email,in_app}', true, now()),
  ('donation.refunded', 'donor', 'donation.foreign_refunded', '{email,in_app}', true, now())
ON CONFLICT ("event_type", "audience", "template_key") DO NOTHING;
