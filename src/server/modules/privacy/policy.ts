import { role, type Policy } from "../../access/domain/policy";

export const PRIVACY_POLICY = {
  "privacy.inventory.view": role("super_admin", "staff_admin"),
} satisfies Policy<string>;
