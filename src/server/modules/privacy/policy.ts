// Who may run retention and manage legal holds (#114): their rules in the
// platform policy (src/server/access/policies.ts).
//
// The sweep itself is the platform's: the worker's schedule, or the CLI.
// A super admin may preview it, and places and releases legal holds with a
// fresh second factor (#60). Staff admins see the data inventory and the
// holds in force, to answer questions about them; no other role does.
//
// Loads under plain Node: relative imports only, no "server-only".

import { role, stepUp, system, type Policy } from "../../access/domain/policy";

export const PRIVACY_POLICY = {
  "privacy.sweep.run": system("worker", "cli"),
  "privacy.sweep.preview": role("super_admin"),
  "privacy.hold.place": stepUp(role("super_admin")),
  "privacy.hold.release": stepUp(role("super_admin")),
  "privacy.hold.view": role("super_admin", "staff_admin"),
  "privacy.inventory.view": role("super_admin", "staff_admin"),
} satisfies Policy<string>;

export type PrivacyAction = keyof typeof PRIVACY_POLICY;
