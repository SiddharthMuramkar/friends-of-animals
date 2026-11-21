// The platform's policy: one rule per action, from every module. A module
// with use cases keeps its rules next to them and adds one argument here;
// an action defined twice fails type-checking. Each rule names its roles;
// super admin is not a wildcard.

import { IDENTITY_POLICY } from "../identity/policy";
import { ACCESS_POLICY } from "./domain/access-policy";
import { composePolicies } from "./domain/policy";

export const POLICY = composePolicies(IDENTITY_POLICY, ACCESS_POLICY);

export type Action = keyof typeof POLICY;
