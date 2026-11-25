// Who may run the donation use cases (#106): their rules in the platform
// policy (src/server/access/policies.ts). Giving is open to anyone on the
// site, signed in or not (a guest only while `donations.allowGuest`); a
// donation's checkout and thank-you pages are reached with its checkout
// token, which the use cases check. Finance reads donations and hands out
// receipt links; the donor gets new ones by email.
//
// Loads under plain Node: relative imports only, no "server-only".

import {
  anyOf,
  owner,
  role,
  signedIn,
  signedOut,
  stepUp,
  system,
  type Policy,
} from "../../access/domain/policy";

/** A person on the site: a visitor or a signed-in member. */
const ANYONE = anyOf(signedOut, signedIn);

export const DONATIONS_POLICY = {
  // Starting a donation. A signed-in minor is refused by the use case
  // itself, which can tell (#55): the policy can't read ages.
  "donation.start": ANYONE,
  // Paying for, confirming and reading the outcome of one donation: whoever
  // holds its checkout token.
  "donation.checkout": ANYONE,
  // Opening a receipt by its link: whoever holds the link's token.
  "donation.receipt.read": ANYONE,
  // A new link to a receipt: the donor's own account (emailed), or
  // finance (shown on screen, never mailed).
  "donation.receipt.reissue": anyOf(owner, role("finance")),
  // A guest asking for a new link with their email and receipt number.
  "donation.receipt.request": ANYONE,
  // Finance's list and detail. Names and emails of donors are personal
  // data: finance only, and super admin is no wildcard.
  "donation.read": role("finance"),
  "donation.offline.record": stepUp(role("finance")),
  // Asking for a donation's money back. Finance decides it as any refund
  // (refunds.decide), and nobody decides their own request.
  "donation.refund.request": role("finance", "staff_admin", "super_admin"),
  // Expiring donations left unpaid: the worker's schedule, or the CLI.
  "donation.expire": system("worker", "cli"),
} satisfies Policy<string>;
