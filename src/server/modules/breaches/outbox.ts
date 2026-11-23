import { and, eq, type SQL } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { outbox } from "../../db/schema";

/** Resubmission gives the original failed events another chance. */
export async function retryBreachEvents(
  tx: AppDb,
  breachId: string,
  now: Date,
  ...matches: [SQL, ...SQL[]]
) {
  const retried = await tx
    .update(outbox)
    .set({
      status: "pending",
      attempts: 0,
      availableAt: now,
      lockedUntil: null,
      failedAt: null,
      lastError: null,
    })
    .where(
      and(
        eq(outbox.aggregateType, "breach"),
        eq(outbox.aggregateId, breachId),
        eq(outbox.status, "failed"),
        ...matches
      )
    )
    .returning({ id: outbox.id });
  return retried.length;
}
