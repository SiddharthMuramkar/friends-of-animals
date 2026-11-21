// Who may run the coordinator use cases (#74): their rules in the platform
// policy (src/server/access/policies.ts).
//
// Loads under plain Node: relative imports only, no "server-only".

import {
  anyOf,
  role,
  signedIn,
  signedOut,
  type Policy,
} from "../../access/domain/policy";

export const COORDINATORS_POLICY = {
  // Inviting, listing and removing coordinators, and withdrawing an
  // invitation: the institution's authorised person, at that institution.
  // Its coordinators can't; nor can the authorised person of another.
  "institution.coordinators.manage": role("institution_admin"),
  // The link is the credential for reading what it invites to: anyone
  // holding it sees the institution's name and a masked address.
  "institution.invitation.view": anyOf(signedOut, signedIn),
  // Accepting needs an account: the use case then checks its email or
  // phone is the one invited.
  "institution.invitation.accept": signedIn,
} satisfies Policy<string>;
