import { describe, expect, it } from "vitest";

import type { User } from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import { createHarness, type Harness } from "@/test/harness";

import {
  listRegistrationsForPerson,
  registerAttendee,
  type RegistrableEvent,
} from "./places";

/** 07:00 IST on 13 February 2027, four weeks after the test world starts. */
const STARTS_AT = new Date("2027-02-13T01:30:00.000Z");

/**
 * A published event open for registration, with two places and a waitlist.
 * A plain value until 125a's `event` table is on this branch; then it is
 * seeded with `h.seed.event(...)`.
 */
function publishedEvent(
  h: Harness,
  overrides: Partial<RegistrableEvent> = {}
): RegistrableEvent {
  return {
    id: uuidv7(h.clock.now()),
    status: "published",
    publishedAt: h.clock.now(),
    startsAt: STARTS_AT,
    registrationOpensAt: null,
    registrationClosesAt: null,
    capacity: 2,
    waitlistEnabled: true,
    audience: "signed_in",
    ...overrides,
  };
}

/** `member` registers themselves, in a transaction of its own. */
function registerSelf(
  h: Harness,
  event: RegistrableEvent,
  member: User,
  { registrantIsMember = true }: { registrantIsMember?: boolean } = {}
) {
  return h.db.transaction((tx) =>
    registerAttendee(tx, h.clock, {
      event,
      attendee: { kind: "user", userId: member.id },
      registeredByUserId: member.id,
      registrantIsMember,
    })
  );
}

describe("registering for an event", () => {
  it("gives places up to the capacity, then puts people on the waitlist", async () => {
    const h = await createHarness();
    const event = publishedEvent(h, { capacity: 2 });
    const a = await h.seed.member();
    const b = await h.seed.member();
    const c = await h.seed.member();

    const statuses = [];
    for (const member of [a, b, c]) {
      const result = await registerSelf(h, event, member);
      statuses.push(result.ok ? result.status : result.error);
      h.clock.advance({ minutes: 1 });
    }

    expect(statuses).toEqual(["registered", "registered", "waitlisted"]);
    expect(await listRegistrationsForPerson(h.db, c.id)).toEqual([
      expect.objectContaining({
        eventId: event.id,
        attendee: { kind: "user", userId: c.id },
        status: "waitlisted",
        waitlistPosition: 1,
      }),
    ]);
    expect(await listRegistrationsForPerson(h.db, a.id)).toEqual([
      expect.objectContaining({ status: "registered", waitlistPosition: null }),
    ]);
  });
});
