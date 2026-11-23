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
// Only an email accepted by the port or a manual filing completes the
// notice. Completion stamps authority_notified_at and adds its timeline
// event and audit row. A manual filing retires an outstanding email.
// Loads under plain Node: relative imports only, no "server-only".

import { eq } from "drizzle-orm";
import { z } from "zod";

import type { Ciphertext } from "../../crypto/field-cipher";
import type { AppDb } from "../../db/app-db";
import { breachRecord, type BreachRecordRow } from "../../db/schema";
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

export type NotifyAuthorityResult =
  | { ok: true; channel: "email" | "manual" }
  | InvalidInput
  | {
      ok: false;
      error:
        | "not_found"
        | "breach_closed"
        | "already_notified"
        | "authority_email_queued"
        | "authority_unconfigured"
        | "authority_email_invalid";
    };

/** Queues an authority email, or records a notice filed by hand. */
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
      if (!decideBreachTransition(breach, "notify").ok)
        return { result: CLOSED };
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
      const now = ctx.clock.now();
      if (plan.kind === "email") {
        if (breach.authorityEmailQueuedAt !== null) {
          return { result: { ok: false, error: "authority_email_queued" } };
        }
        await tx
          .update(breachRecord)
          .set({ authorityEmailQueuedAt: now, updatedAt: now })
          .where(eq(breachRecord.id, breachId));
        await emit(tx, ctx.clock, {
          type: "breach.authority_notice",
          aggregate: { type: "breach", id: breachId },
          payload: { breachId },
        });
        const snapshot = breachAuditSnapshot(breach);
        return {
          result: { ok: true, channel: "email" },
          audit: {
            action: "breach.authority_email_queued",
            breachId,
            before: snapshot,
            after: snapshot,
          },
        };
      }

      const updated = await completeAuthorityNotice(tx, breach, now, {
        channel: "manual",
        authorUserId: staff.userId,
        reference: sealBreachText(
          ctx.cipher,
          "authorityReference",
          plan.reference
        ),
      });
      return {
        result: { ok: true, channel: "manual" },
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

type AuthorityDelivery =
  | { channel: "email" }
  | { channel: "manual"; authorUserId: string; reference: Ciphertext };

/** Records delivery while holding the same breach lock as the sender. */
export async function completeAuthorityNotice(
  tx: AppDb,
  breach: BreachRecordRow,
  at: Date,
  delivery: AuthorityDelivery
): Promise<BreachRecordRow> {
  const decision = decideBreachTransition(breach, "notify");
  const [updated] = await tx
    .update(breachRecord)
    .set({
      // An email queued before closure can finish with the breach still closed.
      status: decision.ok ? decision.to : breach.status,
      authorityNotifiedAt: at,
      authorityEmailQueuedAt: null,
      authorityEmailSentAt: delivery.channel === "email" ? at : null,
      authorityReference:
        delivery.channel === "manual" ? delivery.reference : null,
      updatedAt: at,
    })
    .where(eq(breachRecord.id, breach.id))
    .returning();
  if (!updated) throw new Error(`Breach ${breach.id} vanished while locked`);
  await appendTimeline(tx, {
    breachId: breach.id,
    kind: "authority_notified",
    authorUserId: delivery.channel === "manual" ? delivery.authorUserId : null,
    at,
  });
  return updated;
}
