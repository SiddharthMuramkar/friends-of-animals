// Who may upload and read files (#63). The status gate on top of these
// rules (only the uploader opens an unscanned file; nobody opens a
// quarantined one) is in ./domain/delivery.ts.
//
// Loads under plain Node: relative imports only, no "server-only".

import {
  anyOf,
  owner,
  role,
  signedIn,
  type Policy,
} from "../../access/domain/policy";

export const FILES_POLICY = {
  /** Any signed-in user may upload; each purpose's own rules still apply. */
  "file.upload": signedIn,
  /** Only the uploader confirms their upload. */
  "file.complete": owner,
  /** The uploader, and staff who look after users' files. */
  "file.read": anyOf(owner, role("staff_admin", "super_admin")),
} satisfies Policy<string>;

export type FilesAction = keyof typeof FILES_POLICY;
