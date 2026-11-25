import { role, stepUp, system, type Policy } from "../../access/domain/policy";
const reviewers = role("competition_manager", "staff_admin", "super_admin");
export const RESULTS_POLICY = {
  "results.read": reviewers,
  "results.prepare": role("competition_manager"),
  "results.approve": stepUp(reviewers),
  "results.reject": reviewers,
  "results.publish": system("worker"),
  "results.public_read": (subject) => ({
    allowed: subject.kind !== "system",
    role: null,
  }),
} satisfies Policy<string>;
