// Who may run the directory use cases (#127): their rules in the platform
// policy (src/server/access/policies.ts). Anyone signed in may register a
// listing. The listing's own people act for it: the person who registered
// it until FOA first verifies it, then its organisation representatives
// (./domain/listing-edit.ts builds that resource). FOA's staff admins and
// super admins review, decide and open its documents; they don't edit what
// the organisation says about itself. Anyone may read a verified listing.
//
// Loads under plain Node: relative imports only, no "server-only".

import {
  anyOf,
  owner,
  role,
  signedIn,
  type Policy,
  type Rule,
} from "../../access/domain/policy";

const foaAdmin = role("staff_admin", "super_admin");

/** Anyone: a visitor, a signed-in user, the platform. */
const anyone: Rule = () => ({ allowed: true, role: null });

export const DIRECTORY_POLICY = {
  "directory.register": signedIn,
  /** The listings the signed-in user acts for; the query is theirs. */
  "directory.view_own": signedIn,
  /** Read in full, edit, withdraw, upload documents. */
  "directory.manage": anyOf(owner, role("organisation_representative")),
  "directory.review": foaAdmin,
  "directory.decide": foaAdmin,
  /** Proof uploaded for verification: staff only, never its uploader. */
  "directory.document.read": foaAdmin,
  "directory.read_public": anyone,
} satisfies Policy<string>;

export type DirectoryAction = keyof typeof DIRECTORY_POLICY;
