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

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { Ciphertext } from "../../crypto/field-cipher";
import type { AppDb } from "../../db/app-db";
import {
  breachRecord,
  messageRoute,
  outbox,
  type BreachRecordRow,
} from "../../db/schema";
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
import { retryBreachEvents } from "./outbox";
import { appendTimeline, CLOSED, lockBreach, NOT_FOUND } from "./record";
import { withBreachStaff, type BreachContext } from "./with-breach-staff";

const notifyAuthorityInput = z.strictObject({
  breachId: z.uuid(),
  manualReference: z.string().trim().max(AUTHORITY_REFERENCE_MAX).optional(),
});

const AUTHORITY_NOTICE = "breach.authority_notice";

/** Finds and holds the enabled route while retrying or delivering this email. */
export async function authorityEmailRoute(tx: AppDb) {
  const [route] = await tx
    .select({
      templateKey: messageRoute.templateKey,
      channels: messageRoute.channels,
    })
    .from(messageRoute)
    .where(
      and(
        eq(messageRoute.eventType, AUTHORITY_NOTICE),
        eq(messageRoute.audience, "breach_authority"),
        eq(messageRoute.templateKey, AUTHORITY_NOTICE),
        eq(messageRoute.requiredByLaw, true),
        eq(messageRoute.enabled, true)
      )
    )
    .for("share");
  return route?.channels.includes("email") ? route : undefined;
}

export async function failedAuthorityEmailAt(db: AppDb, breachId: string) {
  const [delivery] = await db
    .select({ failedAt: outbox.failedAt })
    .from(outbox)
    .where(
      and(
        eq(outbox.aggregateType, "breach"),
        eq(outbox.aggregateId, breachId),
        eq(outbox.eventType, AUTHORITY_NOTICE),
        eq(outbox.status, "failed")
      )
    );
  return delivery?.failedAt ?? null;
}

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
        | "authority_email_route_unavailable"
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
      const closed = breach.status === "closed";
      const failedAt = breach.authorityEmailQueuedAt
        ? await failedAuthorityEmailAt(tx, breachId)
        : null;
      if (closed && (breach.authorityNotifiedAt || !failedAt))
        return { result: CLOSED };
      if (breach.authorityNotifiedAt !== null) {
        return { result: { ok: false, error: "already_notified" } };
      }

      const plan = planAuthorityNotice({
        authorityEmail: await readSetting(tx, "breach.authorityEmail"),
        manualReference,
      });
      if (closed && plan.kind !== "email") return { result: CLOSED };
      if (plan.kind === "refused") {
        return { result: { ok: false, error: plan.reason } };
      }
      const now = ctx.clock.now();
      if (plan.kind === "email") {
        const retry = breach.authorityEmailQueuedAt !== null;
        if (retry) {
          if (!failedAt) {
            return { result: { ok: false, error: "authority_email_queued" } };
          }
          if (!(await authorityEmailRoute(tx))) {
            return {
              result: { ok: false, error: "authority_email_route_unavailable" },
            };
          }
          const retried = await retryBreachEvents(
            tx,
            breachId,
            now,
            eq(outbox.eventType, AUTHORITY_NOTICE)
          );
          if (!retried)
            return { result: { ok: false, error: "authority_email_queued" } };
        } else {
          await tx
            .update(breachRecord)
            .set({ authorityEmailQueuedAt: now, updatedAt: now })
            .where(eq(breachRecord.id, breachId));
          await emit(tx, ctx.clock, {
            type: AUTHORITY_NOTICE,
            aggregate: { type: "breach", id: breachId },
            payload: { breachId },
          });
        }
        const snapshot = breachAuditSnapshot(breach);
        return {
          result: { ok: true, channel: "email" },
          audit: {
            action: retry
              ? "breach.authority_email_requeued"
              : "breach.authority_email_queued",
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
