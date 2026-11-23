import type { AppDb } from "../../db/app-db";
import type { BreachNotificationRow } from "../../db/schema";
import type { OutboxDeps } from "../../outbox/handlers";
import { affectedPeople } from "./affected";
import {
  planBreachNotices,
  type AffectedRef,
} from "./domain/notice-recipients";
import { queueNotices, reachedRefs, recordUnreachable } from "./notify";

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
  const nowAdults = people.filter(
    ({ ref, minor }) => ref.type === "participant_profile" && !minor
  );
  if (nowAdults.length > 0) {
    const replanned = planBreachNotices(nowAdults);
    await queueNotices(
      tx,
      deps.clock,
      notice.breachId,
      replanned,
      reachedRefs(
        nowAdults.map(({ ref }) => ref),
        replanned
      )
    );
  }
  // An affected adult gets their own notice. A previously affected child
  // can contribute to this recipient's notice only through a live link.
  const plan = planBreachNotices(
    people.filter(({ ref, minor }) =>
      ref.type === "participant_profile" ? minor : !minor
    )
  );
  await recordUnreachable(tx, notice.breachId, now, plan.unreachable);
  const scope = plan.recipients.find(
    ({ userId }) => userId === recipientUserId
  );
  return scope ? { as: scope.as, aboutCount: scope.about.length } : null;
}
