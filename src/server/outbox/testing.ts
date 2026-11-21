// Test helpers for code that emits or drains outbox events. Tests only:
// nothing in the app imports this file.

import type { DbWithClock } from "../db/app-db";
import { emit } from "./emit";
import type { DomainEvent } from "./events";

/** identity.user_signed_up for `userId`, as sign-up emits it. */
export function userSignedUp(userId: string): DomainEvent {
  return {
    type: "identity.user_signed_up",
    aggregate: { type: "user", id: userId },
    payload: { userId },
  };
}

/** Emits identity.user_signed_up for `userId` in a transaction of its own. */
export async function emitUserSignedUp(
  { db, clock }: DbWithClock,
  userId: string,
  options: { availableAt?: Date } = {}
): Promise<void> {
  await db.transaction((tx) => emit(tx, clock, userSignedUp(userId), options));
}
