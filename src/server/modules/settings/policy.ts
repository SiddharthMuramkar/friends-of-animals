// Who may see and change runtime settings (#62): a super admin only. A
// staff admin is refused; super admin is not a wildcard, so the rule names
// it. A change also needs a second factor passed within the step-up window
// (#60); can() checks it. Loads under plain Node: relative imports only.

import { role, stepUp, type Policy } from "../../access/domain/policy";

export const SETTINGS_POLICY = {
  "setting.view": role("super_admin"),
  "setting.change": stepUp(role("super_admin")),
} satisfies Policy<string>;

export type SettingsAction = keyof typeof SETTINGS_POLICY;
