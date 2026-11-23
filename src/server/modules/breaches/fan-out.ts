// The outbox handler breaches.fan_out (#116 AC5): tells every account of a
// breach, one page at a time, in the worker rather than a request.
//
// Each delivery handles the next `pageSize` accounts after `afterUserId`.
// It resolves those subjects and also looks up affected children for any
// guardian in the page. This lets each recipient's own page queue one
// complete notice. A full page saves the next cursor in the same
// transaction as its notices, so the chain resumes after a crash.
//
// Once requested, notices finish even if staff close the record. A page
// run twice queues nothing new; at worst it saves its next page twice,
// and that page then queues nothing new either.
//
// Loads under plain Node (the worker): relative imports only.

import { asc, eq, gt } from "drizzle-orm";

import { breachRecord, user } from "../../db/schema";
import { emit } from "../../outbox/emit";
import type { OutboxDeps } from "../../outbox/handlers";
import { affectedPeople, minorAccountsOfGuardians } from "./affected";
import { planBreachNotices } from "./domain/notice-recipients";
import { queueNotices, reachedRefs } from "./notify";

export async function fanOutBreachNotices(
  deps: Pick<OutboxDeps, "db" | "clock" | "cipher">,
  page: { breachId: string; afterUserId: string | null; pageSize: number }
): Promise<void> {
  const { breachId, afterUserId, pageSize } = page;
  await deps.db.transaction(async (tx) => {
    const [breach] = await tx
      .select({ id: breachRecord.id })
      .from(breachRecord)
      .where(eq(breachRecord.id, breachId));
    if (!breach) return;

    const accounts = await tx
      .select({ id: user.id })
      .from(user)
      .where(afterUserId === null ? undefined : gt(user.id, afterUserId))
      .orderBy(asc(user.id))
      .limit(pageSize);
    const last = accounts.at(-1);
    if (!last) return;

    const refs = accounts.map((account) => ({
      type: "user" as const,
      id: account.id,
    }));
    const accountIds = accounts.map(({ id }) => id);
    const recipientsOnPage = new Set(accountIds);
    const now = deps.clock.now();
    const people = await affectedPeople(tx, deps.cipher, now, refs);
    const children = await minorAccountsOfGuardians(
      tx,
      deps.cipher,
      now,
      accountIds
    );
    const plan = planBreachNotices([...people, ...children]);
    await queueNotices(
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

    if (accounts.length === pageSize) {
      await emit(tx, deps.clock, {
        type: "breach.fan_out_requested",
        aggregate: { type: "breach", id: breachId },
        payload: { breachId, afterUserId: last.id, pageSize },
      });
    }
  });
}
