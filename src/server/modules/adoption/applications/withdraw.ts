// The applicant takes back an open application (#130). The coordinator and
// the listing organisation are told. Loads under plain Node.

import { z } from "zod";

import { authorize } from "../../../access/can";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import type { AdoptionApplicationTransitionRefusal } from "../domain/application-status";
import { moveApplication } from "./move";
import { applicationWithListing, refused } from "./record";

export type WithdrawAdoptionApplicationResult =
  | { ok: true }
  | InvalidInput
  | { ok: false; error: AdoptionApplicationTransitionRefusal };

const input = z.object({ applicationId: z.uuid() });

export async function withdrawAdoptionApplication(
  ctx: UseCaseContext,
  raw: { applicationId: string }
): Promise<WithdrawAdoptionApplicationResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return invalidInput(parsed.error);
  return ctx.db.transaction(async (tx) => {
    const found = await applicationWithListing(tx, parsed.data.applicationId, {
      lock: true,
    });
    if (!found) refused(ctx, "adoption.application.withdraw");
    const { role } = await authorize(
      { ...ctx, db: tx },
      "adoption.application.withdraw",
      { ownerId: found.application.applicantUserId }
    );
    const moved = await moveApplication(ctx, tx, {
      application: found.application,
      action: "withdraw",
      actor: "applicant",
      actorRole: role,
    });
    return moved.ok ? ({ ok: true } as const) : moved;
  });
}
