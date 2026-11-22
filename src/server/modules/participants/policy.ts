// Who may run the participants module's use cases (#78): their rules in the
// platform policy (src/server/access/policies.ts). An adult acts for
// themselves only: any signed-in member may register as an individual and
// list their own registrations, and only the owner of a registration's
// profile may pay for it.
//
// Loads under plain Node: relative imports only, no "server-only".

import { owner, signedIn, type Policy } from "../../access/domain/policy";

export const PARTICIPANTS_POLICY = {
  "registration.individual.create": signedIn,
  // The resource names the profile's owner; a registration of somebody
  // else's, or none at all, is refused the same way.
  "registration.self.pay": owner,
  "registration.self.list": signedIn,
} satisfies Policy<string>;
