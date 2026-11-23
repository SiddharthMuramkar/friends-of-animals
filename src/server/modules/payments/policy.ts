// Who may run the payment use cases (#77): their rules in the platform
// policy (src/server/access/policies.ts). Fees are paid and read at the
// institution's scope (`institutionResource`), where its authorised person
// and coordinators hold their roles.
//
// Loads under plain Node: relative imports only, no "server-only".

import {
  anyOf,
  role,
  signedIn,
  signedOut,
  stepUp,
  type Policy,
} from "../../access/domain/policy";

/** FOA's people who look after money (#79). Super admin is named: it is no
 * wildcard. */
const MONEY_STAFF = role("finance", "staff_admin", "super_admin");

export const PAYMENTS_POLICY = {
  // Opening an order for the institution's fees and confirming the
  // Checkout return: its coordinators and its authorised person, at that
  // institution only.
  "payments.pay": role("institution_coordinator", "institution_admin"),
  // Reading a batch and what it paid for: the same people.
  "payments.read": role("institution_coordinator", "institution_admin"),
  // A gateway's webhook arrives with no session: its signature, checked on
  // the raw body, is what authorises it, so anyone may hand one in.
  "payments.gateway_signal": anyOf(signedOut, signedIn),
  // Recording a cheque, transfer or cash confirms registrations as a
  // capture does: money moves, so a fresh second factor (#60). Presigning
  // its proof upload is part of the same act.
  "payments.offline.record": stepUp(MONEY_STAFF),
  // Reading batches, review cases and what was paid (#79).
  "payments.review.read": MONEY_STAFF,
  // Resolving a review case accepts, refunds or keeps money.
  "payments.review.resolve": stepUp(MONEY_STAFF),
  // An offline payment's proof: a cheque image shows an account number and
  // a signature.
  "payments.offline.proof.read": MONEY_STAFF,
  // Refunds (#80). Asking for one: a manager of the batch's competition
  // (or of every competition), or a staff admin.
  "refunds.request": role("competition_manager", "staff_admin", "super_admin"),
  // Approving, rejecting, retrying and recording a manual refund: finance
  // only, behind a fresh second factor, since money moves. Nobody decides
  // their own request (./refunds/decide-refund.ts).
  "refunds.decide": stepUp(role("finance")),
  // Reading refunds: whoever may ask for or decide them.
  "refunds.read": role(
    "finance",
    "staff_admin",
    "super_admin",
    "competition_manager"
  ),
} satisfies Policy<string>;
