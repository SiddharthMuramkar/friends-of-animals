import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { uuidv7 } from "@/server/ids";
import { createHarness } from "@/test/harness";

import type { EventDetailsInput } from "./domain/event-details";
import { eventsModule } from "./index";
import { TestEventsAccess, type TestRole } from "./testing";

// A Saturday beach clean-up, 07:00-10:00 IST on 13 February 2027. The
// harness clock starts on 15 January 2027 at 10:00 IST.
const startsAt = new Date("2027-02-13T01:30:00.000Z");
const endsAt = new Date("2027-02-13T04:30:00.000Z");

const valid: EventDetailsInput = {
  kind: "event",
  title: "Beach clean-up at Juhu",
  summary: "Join volunteers to clear plastic from the shore before the tide.",
  description: [{ p: ["Bring a water bottle and a hat."] }],
  startsAt,
  endsAt,
  venueName: "Juhu Beach, Gate 4",
  address: "",
  city: "Mumbai",
  pinCode: "400049",
  onlineUrl: "",
  capacity: 40,
  audience: "members",
  registrationOpensAt: null,
  registrationClosesAt: null,
  waitlistEnabled: true,
};

/**
 * A harness, the events use cases over test access, and a way to make
 * signed-in people holding one role each.
 */
async function world() {
  const h = await createHarness();
  const access = new TestEventsAccess();
  const events = (actor: Actor) => eventsModule(access)({ ...h.deps, actor });
  const person = async (role: TestRole): Promise<Actor> => {
    const user = await h.seed.member();
    access.grant(user, role);
    return {
      kind: "user",
      userId: user.id,
      sessionId: uuidv7(h.clock.now()),
      meta: { ip: "203.0.113.20", userAgent: "Seam 1 test" },
    };
  };
  const contentManager = await person("content_manager");
  return { h, access, events, person, contentManager, visitor: h.visitor() };
}

describe("createEvent", () => {
  it("saves a draft only staff can see, with who created it and one audit entry", async () => {
    const { access, events, contentManager, visitor } = await world();

    const created = await events(contentManager).createEvent(valid);

    expect(created).toEqual({
      ok: true,
      id: expect.any(String),
      slug: "beach-clean-up-at-juhu",
    });
    if (!created.ok) throw new Error("not created");
    const read = await events(contentManager).getEventForAdmin({
      eventId: created.id,
    });
    expect(read).toMatchObject({
      ok: true,
      event: {
        id: created.id,
        slug: "beach-clean-up-at-juhu",
        status: "draft",
        title: "Beach clean-up at Juhu",
        createdByUserId:
          contentManager.kind === "user" ? contentManager.userId : null,
        publishedAt: null,
      },
    });
    expect(access.audited).toEqual([
      expect.objectContaining({
        action: "event.created",
        entity: { type: "event", id: created.id },
        before: null,
        actorRole: "content_manager",
      }),
    ]);
    expect(await events(visitor).listPublishedEvents()).toEqual([]);
    expect(
      await events(visitor).getPublicEvent({ slug: "beach-clean-up-at-juhu" })
    ).toEqual({ ok: false, error: "not_found" });
  });
});
