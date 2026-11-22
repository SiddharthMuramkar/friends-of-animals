// Who may use a public form's guards: anyone on the site, signed in or
// not. The platform's own processes have no request and no reason to.
// Pure, so the platform policy (src/server/access/policies.ts) can import
// it.

import {
  anyOf,
  signedIn,
  signedOut,
  type Policy,
} from "../../access/domain/policy";

export const PUBLIC_FORMS_POLICY = {
  "human-check.issue": anyOf(signedOut, signedIn),
} satisfies Policy<string>;
