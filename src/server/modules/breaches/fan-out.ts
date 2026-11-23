// The outbox handler breaches.fan_out (#116 AC5): tells every account of a
// breach, one page at a time, in the worker rather than a request.
//
// Each delivery plans the next `pageSize` accounts after `afterUserId`, in
// id order, exactly as a list of subjects is planned (./notify.ts): a child
// account is routed to its guardians, and a recipient already told is
// skipped by breach_notification's unique key. A full page saves the event
// again with the last account as the cursor, in the same transaction as
// its notices, so the chain resumes where it stopped after a crash.
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
import { affectedPeople } from "./affected";
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
    const refs = accounts.map((account) => ({
      type: "user" as const,
      id: account.id,
    }));
    const people = await affectedPeople(
      tx,
      deps.cipher,
      deps.clock.now(),
      refs
    );
    const plan = planBreachNotices(people);
    await queueNotices(tx, deps.clock, breachId, plan, reachedRefs(refs, plan));

    const last = accounts.at(-1);
    if (accounts.length === pageSize && last) {
      await emit(tx, deps.clock, {
        type: "breach.fan_out_requested",
        aggregate: { type: "breach", id: breachId },
        payload: { breachId, afterUserId: last.id, pageSize },
      });
    }
  });
}
