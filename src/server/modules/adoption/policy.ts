// Who may run the adoption use cases (#129): their rules in the platform
// policy (src/server/access/policies.ts). A directory listing's
// organisation representatives (#127) manage its animals: the resource is
// the directory listing's scope, `organisation:<directoryListingId>`. FOA
// staff don't write what an organisation says about its animals;
// suspending the directory listing is FOA's lever. Anyone may read what is
// public.
//
// Applications (#130): any signed-in user may apply; the use case refuses
// minors, the organisation's own representatives and closed animals. The
// applicant reads, withdraws and writes a success story for their own
// (the use case names them the owner). FOA's adoption coordinator, global
// or scoped to the organisation, reads the queue, moves applications on
// and publishes stories; the organisation's representatives read their
// animals' applications. Super admins are not coordinators.
//
// Loads under plain Node: relative imports only, no "server-only".

import {
  owner,
  role,
  signedIn,
  type Policy,
  type Rule,
} from "../../access/domain/policy";

/** Anyone: a visitor, a signed-in user, the platform. */
const anyone: Rule = () => ({ allowed: true, role: null });

export const ADOPTION_POLICY = {
  /** Write, publish, hold, withdraw and read in full; add photos. */
  "adoption.listing.manage": role("organisation_representative"),
  /** Browse adoptable animals, open one, load its public photos. */
  "adoption.listing.read_public": anyone,
  /** Apply, open the apply form, list one's own applications. */
  "adoption.application.apply": signedIn,
  "adoption.application.view_own": owner,
  "adoption.application.withdraw": owner,
  "adoption.story.submit": owner,
  "adoption.story.withdraw": owner,
  /** The coordinator's queue and full view, and their moves. */
  "adoption.application.review": role("adoption_coordinator"),
  "adoption.application.move": role("adoption_coordinator"),
  "adoption.story.publish": role("adoption_coordinator"),
  /** The organisation reads its animals' applications. */
  "adoption.application.owner_read": role("organisation_representative"),
  /** /adopt/stories. */
  "adoption.story.read_public": anyone,
} satisfies Policy<string>;

export type AdoptionAction = keyof typeof ADOPTION_POLICY;
