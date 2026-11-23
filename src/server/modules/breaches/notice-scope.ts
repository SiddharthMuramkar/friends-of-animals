import type { AppDb } from "../../db/app-db";
import type { BreachNotificationRow } from "../../db/schema";
import type { OutboxDeps } from "../../outbox/handlers";
import { affectedPeople } from "./affected";
import {
  planBreachNotices,
  type AffectedRef,
} from "./domain/notice-recipients";
import { queueNotices, recordUnreachable } from "./notify";

/** Resolves only the scope staff queued, under locks held through delivery. */
export async function revalidateNoticeScope(
  tx: AppDb,
  deps: Pick<OutboxDeps, "cipher" | "clock">,
  now: Date,
  notice: BreachNotificationRow,
  recipientUserId: string
) {
  const refs: AffectedRef[] = notice.guardianProfileIds.map((id) => ({
    type: "participant_profile",
    id,
  }));
  if (notice.recipientRole !== "guardian") {
    refs.push({ type: "user", id: recipientUserId });
  }
  const people = await affectedPeople(tx, deps.cipher, now, refs, {
    lock: true,
  });
  const stillInScope = ({ ref, minor }: (typeof people)[number]) =>
    ref.type === "participant_profile" ? minor : !minor;
  const changed = people.filter((person) => !stillInScope(person));
  if (changed.length > 0) {
    await queueNotices(
      tx,
      deps.clock,
      notice.breachId,
      planBreachNotices(changed),
      changed
    );
  }
  // Retain only the part of this recipient's scope they can still receive.
  const plan = planBreachNotices(people.filter(stillInScope));
  await recordUnreachable(tx, notice.breachId, now, plan.unreachable);
  const scope = plan.recipients.find(
    ({ userId }) => userId === recipientUserId
  );
  return scope ? { as: scope.as, aboutCount: scope.about.length } : null;
}
