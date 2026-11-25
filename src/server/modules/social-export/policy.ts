import { role, type Policy } from "../../access/domain/policy";
export const SOCIAL_EXPORT_POLICY = {
  "social_export.manage": role("content_manager", "staff_admin", "super_admin"),
} satisfies Policy<string>;
