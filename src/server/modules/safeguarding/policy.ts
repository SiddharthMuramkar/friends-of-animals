// Who may file and handle safeguarding reports (#116). Stub: every rule
// refuses until the lead role exists.

import { role, type Policy } from "../../access/domain/policy";

export const SAFEGUARDING_LEAD_ACTIONS = [
  "safeguarding.list",
  "safeguarding.view",
  "safeguarding.transition",
  "safeguarding.assign",
  "safeguarding.add-note",
] as const;

export const SAFEGUARDING_POLICY = {
  "safeguarding-concern.submit": role(),
  "safeguarding.list": role(),
  "safeguarding.view": role(),
  "safeguarding.transition": role(),
  "safeguarding.assign": role(),
  "safeguarding.add-note": role(),
} satisfies Policy<string>;

export type SafeguardingAction = keyof typeof SAFEGUARDING_POLICY;
