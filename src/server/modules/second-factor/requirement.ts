// Whether a signed-in user's session meets a second-factor requirement
// right now: what can() asks for every staff action and every step-up
// action, and what staffAccess() asks for staff screens. Read fresh on
// every call. Loads under plain Node: relative imports only.

import type { Role } from "../../access/domain/roles";
import type { AppDb } from "../../db/app-db";
import type { Clock } from "../../ports/clock";
import {
  checkSecondFactor,
  type SecondFactorRefusal,
  type SecondFactorRequirement,
} from "./domain/gate";
import { secondFactorStatus, type SignedInUser } from "./session-factor";
import { SECOND_FACTOR_SETTINGS } from "./settings";

/** Why the session falls short of `requirement`, or null if it meets it. */
export async function secondFactorRefusal(
  { db, clock }: { db: AppDb; clock: Clock },
  actor: SignedInUser,
  requirement: SecondFactorRequirement,
  roles: readonly Role[]
): Promise<SecondFactorRefusal | null> {
  const decision = checkSecondFactor({
    requirement,
    roles,
    status: await secondFactorStatus(db, actor),
    now: clock.now(),
    stepUpWindowMs: SECOND_FACTOR_SETTINGS.stepUpWindowMs,
  });
  return decision.ok ? null : decision.code;
}
