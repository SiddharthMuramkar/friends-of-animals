import { role, type Policy } from "../../access/domain/policy";
import { isStaffRole } from "../../access/domain/roles";

const reportReader = role("super_admin", "staff_admin", "finance", "competition_manager");

export const REPORTS_POLICY = {
  // Home is available to every staff member, including those whose only
  // grant is scoped. Its individual queues are independently authorised.
  "admin_home.view": (subject) => {
    const grant = subject.kind === "user" && subject.grants.find(g => isStaffRole(g.role));
    return grant ? { allowed: true, role: grant.role } : { allowed: false };
  },
  "reports.competition.read": reportReader,
  "reports.competition.export": reportReader,
} satisfies Policy<string>;
