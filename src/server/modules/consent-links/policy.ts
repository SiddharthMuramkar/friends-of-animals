import {
  anyOf,
  role,
  signedIn,
  signedOut,
  type Policy,
} from "../../access/domain/policy";

const coordinator = role("institution_coordinator", "institution_admin");
const bearer = anyOf(signedOut, signedIn);

export const CONSENT_LINKS_POLICY = {
  "consent_link.send": coordinator,
  "consent_link.revoke": coordinator,
  "consent_link.list": coordinator,
  "consent_link.view": bearer,
  "consent_link.code": bearer,
  "consent_link.verify": bearer,
  "consent_link.answer": bearer,
} satisfies Policy<string>;
