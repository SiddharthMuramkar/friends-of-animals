// Who may run FOA verification's use cases (#92): their rules in the
// platform policy (src/server/access/policies.ts).
//
// Only an FOA verifier (a global staff role, so with this session's second
// factor) reads the queue and decides. A competition manager is not a
// verifier (HR-37). The platform forwards individual entries when
// submissions close. Resubmitting a sent-back entry is checked against the
// entries module's own rules (entry.submit, entry.submit_for_student): the
// participant or their guardian, or the student's coordinators.
//
// Loads under plain Node: relative imports only, no "server-only".

import { role, system, type Policy } from "../../access/domain/policy";

export const VERIFICATION_POLICY = {
  "verification.read": role("foa_verifier"),
  "verification.decide": role("foa_verifier"),
  "verification.forward": system("worker", "seed", "cli"),
} satisfies Policy<string>;
