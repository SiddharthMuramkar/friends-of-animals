import {
  anyOf,
  role,
  signedIn,
  signedOut,
  type Policy,
} from "../../access/domain/policy";
export const SURVEYS_POLICY = {
  "survey.manage": role("competition_manager"),
  "survey.dashboard": signedIn,
  "survey.link": anyOf(signedIn, signedOut),
} satisfies Policy<string>;
