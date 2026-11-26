import type { Policy } from "../../access/domain/policy";

export const TRANSPARENCY_POLICY = {
  // This is a public projection, identical for every visitor and user.
  "transparency.read": () => ({ allowed: true, role: null }),
} satisfies Policy<string>;
