// The platform's policy: one rule per action, from every module. A module
// with use cases adds its actions to its own policy object and one entry
// here. Each rule names its roles; super admin is not a wildcard.

import { ACCESS_POLICY } from "./domain/access-policy";

export const POLICY = {
  ...ACCESS_POLICY,
};

export type Action = keyof typeof POLICY;
