// staffAccess(): may the signed-in user open staff screens now? The staff
// layout asks it and sends the user where they can go on: to enrol, or to
// pass their second factor for this session. Staff use cases enforce the
// same rule again through can(), since a layout doesn't run on client
// navigation and a Server Action can be called directly. Loads under plain
// Node: relative imports only.

import { authorize } from "../access/can";
import { isStaffRole } from "../access/domain/roles";
import { grantsOf } from "../access/grants";
import type { SecondFactorRefusal } from "./domain/gate";
import { secondFactorRefusal } from "./requirement";
import { signedInUser } from "./session-factor";
import type { SecondFactorContext } from "./totp";

export type StaffAccess =
  /** `staff` is false for someone without a staff role. */
  | { ok: true; staff: boolean }
  | {
      ok: false;
      code: Exclude<SecondFactorRefusal, "step_up_required">;
    };

export async function staffAccess(
  ctx: SecondFactorContext
): Promise<StaffAccess> {
  await authorize(ctx, "second-factor.staff-access");
  const actor = signedInUser(ctx.actor);
  const roles = (await grantsOf(ctx.db, actor.userId)).map(
    (grant) => grant.role
  );
  if (!roles.some(isStaffRole)) return { ok: true, staff: false };
  const refusal = await secondFactorRefusal(ctx, actor, "staff", roles);
  if (refusal === null) return { ok: true, staff: true };
  if (refusal === "step_up_required") {
    throw new Error("The staff requirement never asks for step-up");
  }
  return { ok: false, code: refusal };
}
