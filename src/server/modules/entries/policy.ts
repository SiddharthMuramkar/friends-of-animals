// Who may run the entries module's use cases (#85): their rules in the
// platform policy (src/server/access/policies.ts).
//
// A participant submits and reads their own entry; a guardian, their
// ward's. The use case names the acting user as the registration's owner
// only when it is theirs (including a linked teen) or their ward's (a
// verified guardian with an active link). Staff see a
// competition's entries only once their files have passed the checks, and
// only competition managers of that competition, or global ones.
//
// Loads under plain Node: relative imports only, no "server-only".

import { owner, role, signedIn, type Policy } from "../../access/domain/policy";

export const ENTRIES_POLICY = {
  "entry.access": signedIn,
  "entry.submit": owner,
  "entry.read": owner,
  "entry.list_mine": signedIn,
  "entry.list_competition": role("competition_manager"),
} satisfies Policy<string>;
