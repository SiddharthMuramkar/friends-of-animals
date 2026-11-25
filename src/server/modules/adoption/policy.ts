// Who may run the adoption use cases (#129): their rules in the platform
// policy (src/server/access/policies.ts). A directory listing's
// organisation representatives (#127) manage its animals: the resource is
// the directory listing's scope, `organisation:<directoryListingId>`. FOA
// staff don't write what an organisation says about its animals;
// suspending the directory listing is FOA's lever. Anyone may read what is
// public. #130 adds the adoption coordinator's actions.
//
// Loads under plain Node: relative imports only, no "server-only".

import { role, type Policy, type Rule } from "../../access/domain/policy";

/** Anyone: a visitor, a signed-in user, the platform. */
const anyone: Rule = () => ({ allowed: true, role: null });

export const ADOPTION_POLICY = {
  /** Write, publish, hold, withdraw and read in full; add photos. */
  "adoption.listing.manage": role("organisation_representative"),
  /** Browse adoptable animals, open one, load its public photos. */
  "adoption.listing.read_public": anyone,
} satisfies Policy<string>;

export type AdoptionAction = keyof typeof ADOPTION_POLICY;
