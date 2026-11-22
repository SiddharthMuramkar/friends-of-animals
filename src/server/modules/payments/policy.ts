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
  type Policy,
} from "../../access/domain/policy";

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
} satisfies Policy<string>;
