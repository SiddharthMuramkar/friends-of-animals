// The platform's policy: one rule per action, from every module. A module
// with use cases keeps its rules next to them and adds one entry here.
// Each rule names its roles; super admin is not a wildcard.

import { IDENTITY_POLICY } from "../identity/policy";
import { FILES_POLICY } from "../modules/files/policy";
import { ACCESS_POLICY } from "./domain/access-policy";

export const POLICY = {
  ...IDENTITY_POLICY,
  ...ACCESS_POLICY,
  ...FILES_POLICY,
};

export type Action = keyof typeof POLICY;
