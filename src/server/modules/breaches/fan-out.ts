// The outbox handler breaches.fan_out (#116 AC5): tells every account of a
// breach, one page at a time, in the worker rather than a request.
//
// Each delivery handles the next `pageSize` accounts after `afterUserId`.
// It resolves those subjects and also looks up affected children for any
// guardian in the page. This lets each recipient's own page queue one
// complete notice. A full page saves the next cursor in the same
// transaction as its notices, so the chain resumes after a crash.
//
// A saved job advances only if this event is for its current cursor. The
// last page completes the job and records its audit in that transaction.
// Once requested, notices finish even if staff close the record.
//
// Loads under plain Node (the worker): relative imports only.

import { asc, eq, gt } from "drizzle-orm";

import { recordAudit } from "../../audit/record";
import { breachFanOut, user } from "../../db/schema";
import { emit } from "../../outbox/emit";
import type { OutboxDeps } from "../../outbox/handlers";
import { affectedPeople, minorAccountsOfGuardians } from "./affected";
import { breachAuditSnapshot } from "./domain/audit";
import { planBreachNotices } from "./domain/notice-recipients";
import { queueNotices, reachedRefs, recordPrincipalNotices } from "./notify";
import { lockBreach } from "./record";

export async function fanOutBreachNotices(
  deps: Pick<OutboxDeps, "db" | "clock" | "cipher">,
  page: { breachId: string; afterUserId: string | null; pageSize: number }
): Promise<void> {
  const { breachId, afterUserId, pageSize } = page;
  await deps.db.transaction(async (tx) => {
    // Staff requests and closure use this lock before checking the fan-out.
    const breach = await lockBreach(tx, breachId);
    if (!breach) return;
    const [job] = await tx
      .select()
      .from(breachFanOut)
      .where(eq(breachFanOut.breachId, breachId));
    if (!job || job.completedAt || job.afterUserId !== afterUserId) return;

    const accounts = await tx
      .select({ id: user.id })
      .from(user)
      .where(afterUserId === null ? undefined : gt(user.id, afterUserId))
      .orderBy(asc(user.id))
      .limit(pageSize);
    const last = accounts.at(-1);

    const refs = accounts.map((account) => ({
      type: "user" as const,
      id: account.id,
    }));
    const accountIds = accounts.map(({ id }) => id);
    const recipientsOnPage = new Set(accountIds);
    const now = deps.clock.now();
    const auditContext = {
      clock: deps.clock,
      actor: { kind: "system", process: "worker" },
    } as const;
    const entity = { type: "breach", id: breachId };
    let currentBreach = breach;
    if (last) {
      const people = await affectedPeople(tx, deps.cipher, now, refs);
      const children = await minorAccountsOfGuardians(
        tx,
        deps.cipher,
        now,
        accountIds
      );
      const plan = planBreachNotices([...people, ...children]);
      const { queued } = await queueNotices(
        tx,
        deps.clock,
        breachId,
        {
          ...plan,
          recipients: plan.recipients.filter(({ userId }) =>
            recipientsOnPage.has(userId)
          ),
        },
        reachedRefs(refs, plan)
      );
      if (queued > 0 && breach.principalsNotifiedAt === null) {
        const { updated, audit } = await recordPrincipalNotices(
          tx,
          breach,
          now,
          queued,
          null
        );
        await recordAudit(tx, auditContext, {
          action: audit.action,
          entity,
          actorRole: null,
          before: audit.before,
          after: audit.after,
        });
        currentBreach = updated;
      }
    }

    if (last && accounts.length === pageSize) {
      await tx
        .update(breachFanOut)
        .set({ afterUserId: last.id })
        .where(eq(breachFanOut.breachId, breachId));
      await emit(tx, deps.clock, {
        type: "breach.fan_out_requested",
        aggregate: { type: "breach", id: breachId },
        payload: { breachId, afterUserId: last.id, pageSize },
      });
      return;
    }

    await tx
      .update(breachFanOut)
      .set({ afterUserId: null, completedAt: now })
      .where(eq(breachFanOut.breachId, breachId));
    await recordAudit(tx, auditContext, {
      action: "breach.fan_out_completed",
      entity,
      actorRole: null,
      before: null,
      after: breachAuditSnapshot(currentBreach),
    });
  });
}
