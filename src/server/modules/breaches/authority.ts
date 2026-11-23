// Telling the authority about a breach (#116).
//
//   notifyAuthority({ breachId, manualReference? })
//
// How it goes is planned by ./domain/authority-notice.ts. With the setting
// `breach.authorityEmail` set, a `breach.authority_notice` event is saved
// and the outbox emails that address (./authority-message.ts). While it is
// unset, staff file the notice by hand (until FOA's counsel names the
// channel, HR-49) and record the reference the authority gave them, kept
// encrypted. With neither, nothing is recorded. The authority is told once
// per breach.
//
// Either way the breach moves to `notified` (a notice may go before
// containment), stamps authority_notified_at, and writes one timeline event
// and one audit row (never the reference). Loads under plain Node: relative
// imports only, no "server-only".

import { eq } from "drizzle-orm";
import { z } from "zod";

import { breachRecord } from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import { emit } from "../../outbox/emit";
import { readSetting } from "../settings/read";
import { sealBreachText } from "./content";
import { breachAuditSnapshot } from "./domain/audit";
import {
  AUTHORITY_REFERENCE_MAX,
  planAuthorityNotice,
} from "./domain/authority-notice";
import { decideBreachTransition } from "./domain/breach-status";
import { appendTimeline, CLOSED, lockBreach, NOT_FOUND } from "./record";
import { withBreachStaff, type BreachContext } from "./with-breach-staff";

const notifyAuthorityInput = z.strictObject({
  breachId: z.uuid(),
  manualReference: z.string().trim().max(AUTHORITY_REFERENCE_MAX).optional(),
});

const emailAddress = z.email();

export type NotifyAuthorityResult =
  | { ok: true; channel: "email" | "manual" }
  | InvalidInput
  | {
      ok: false;
      error:
        | "not_found"
        | "breach_closed"
        | "already_notified"
        | "authority_unconfigured"
        | "authority_email_invalid";
    };

/** Emails the authority, or records the reference of a notice filed by hand. */
export async function notifyAuthority(
  ctx: BreachContext,
  input: unknown
): Promise<NotifyAuthorityResult> {
  return withBreachStaff<NotifyAuthorityResult>(
    ctx,
    "breach.notify",
    async (tx, staff) => {
      const parsed = notifyAuthorityInput.safeParse(input);
      if (!parsed.success) return { result: invalidInput(parsed.error) };
      const { breachId, manualReference } = parsed.data;

      const breach = await lockBreach(tx, breachId);
      if (!breach) return { result: NOT_FOUND };
      const decision = decideBreachTransition(breach, "notify");
      if (!decision.ok) return { result: CLOSED };
      if (breach.authorityNotifiedAt !== null) {
        return { result: { ok: false, error: "already_notified" } };
      }

      const plan = planAuthorityNotice({
        authorityEmail: await readSetting(tx, "breach.authorityEmail"),
        manualReference,
      });
      if (plan.kind === "refused") {
        return { result: { ok: false, error: plan.reason } };
      }
      if (plan.kind === "email" && !emailAddress.safeParse(plan.to).success) {
        return { result: { ok: false, error: "authority_email_invalid" } };
      }

      const now = ctx.clock.now();
      const [updated] = await tx
        .update(breachRecord)
        .set({
          status: decision.to,
          authorityNotifiedAt: now,
          ...(plan.kind === "manual"
            ? {
                authorityReference: sealBreachText(
                  ctx.cipher,
                  "authorityReference",
                  plan.reference
                ),
              }
            : {}),
          updatedAt: now,
        })
        .where(eq(breachRecord.id, breachId))
        .returning();
      if (!updated) throw new Error(`Breach ${breachId} vanished while locked`);
      if (plan.kind === "email") {
        await emit(tx, ctx.clock, {
          type: "breach.authority_notice",
          aggregate: { type: "breach", id: breachId },
          payload: { breachId },
        });
      }
      await appendTimeline(tx, {
        breachId,
        kind: "authority_notified",
        authorUserId: staff.userId,
        at: now,
      });
      return {
        result: { ok: true, channel: plan.kind },
        audit: {
          action: "breach.authority_notified",
          breachId,
          before: breachAuditSnapshot(breach),
          after: breachAuditSnapshot(updated),
        },
      };
    }
  );
}
