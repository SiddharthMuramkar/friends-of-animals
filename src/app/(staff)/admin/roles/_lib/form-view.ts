// What the grant and revoke forms show after a refused change: the alert
// and field errors, already translated, and what was entered so the form
// keeps it. A change that worked redirects instead.

import type { RoleField } from "./action-result";

export type RoleFormView = {
  alert?: string;
  errors: Partial<Record<RoleField, string>>;
  values: Record<RoleField, string>;
};

export const EMPTY_ROLE_FORM: RoleFormView = {
  errors: {},
  values: { role: "", scopeType: "", scopeId: "" },
};
