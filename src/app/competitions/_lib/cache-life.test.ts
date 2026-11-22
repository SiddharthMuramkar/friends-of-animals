import { describe, expect, it } from "vitest";

import type { PublicCompetition } from "@/server/modules/competitions";
import { createHarness } from "@/test/harness";

import { publicCacheLife } from "./cache-life";
import { PUBLIC_READER } from "./public-reader";

// How long the public pages keep a cached read of published competitions.
// The worker moves statuses on the schedule (#71) and can't refresh Next's
// cache, so a read must not outlive the next move it would miss.

const NOW = new Date("2027-01-15T04:30:00.000Z");
const MINUTE_MS = 60 * 1000;

/** `ms` after NOW (before it when negative). */
const at = (ms: number) => new Date(NOW.getTime() + ms);

type Scheduled = Pick<PublicCompetition, "status" | "keyDates">;

/** Registration opens at `opens` and closes a month after. */
function published(opens: Date): Scheduled {
  return {
    status: "published",
    keyDates: [
      { kind: "registration_opens", at: opens },
      { kind: "registration_closes", at: at(30 * 24 * 60 * MINUTE_MS) },
    ],
  };
}

/** Registration opened a week ago and closes at `closes`. */
function open(closes: Date): Scheduled {
  return {
    status: "registration_open",
    keyDates: [
      { kind: "registration_opens", at: at(-7 * 24 * 60 * MINUTE_MS) },
      { kind: "registration_closes", at: closes },
    ],
  };
}

const HOURS = { stale: 300, revalidate: 3600, expire: 86_400 };

describe("the public pages' cache life", () => {
  it("keeps the hours profile when nothing is read", () => {
    expect(publicCacheLife([], NOW)).toEqual(HOURS);
  });

  it("keeps the hours profile when no move is ahead", () => {
    const closed: Scheduled = {
      status: "registration_closed",
      keyDates: [
        { kind: "registration_opens", at: at(-30 * MINUTE_MS) },
        { kind: "registration_closes", at: at(-10 * MINUTE_MS) },
        { kind: "submissions_close", at: at(10 * MINUTE_MS) },
      ],
    };
    expect(publicCacheLife([closed], NOW)).toEqual(HOURS);
  });

  it("keeps the hours profile when the next move is more than an hour off", () => {
    expect(publicCacheLife([published(at(61 * MINUTE_MS))], NOW)).toEqual(
      HOURS
    );
  });

  it("refreshes when registration opens", () => {
    expect(publicCacheLife([published(at(10 * MINUTE_MS))], NOW)).toEqual({
      ...HOURS,
      revalidate: 600,
    });
  });

  it("refreshes when registration closes", () => {
    expect(publicCacheLife([open(at(20 * MINUTE_MS))], NOW)).toEqual({
      ...HOURS,
      revalidate: 1200,
    });
  });

  it("refreshes at the soonest move among the competitions read", () => {
    const life = publicCacheLife(
      [published(at(50 * MINUTE_MS)), open(at(15 * MINUTE_MS))],
      NOW
    );
    expect(life.revalidate).toBe(900);
  });

  it("never refreshes before the move's instant", () => {
    const life = publicCacheLife([published(at(90_500))], NOW);
    expect(life.revalidate).toBe(91);
  });

  it("lives at least a minute, however close the move", () => {
    expect(publicCacheLife([published(at(5_000))], NOW).revalidate).toBe(60);
  });

  it("checks again each minute once a move is due but the worker hasn't made it", () => {
    expect(publicCacheLife([published(at(-1))], NOW).revalidate).toBe(60);
    expect(publicCacheLife([open(at(-30 * MINUTE_MS))], NOW).revalidate).toBe(
      60
    );
  });

  it("follows the seeded competitions through a move the worker makes", async () => {
    const h = await createHarness({ now: "2026-11-21T06:30:00.000Z" });
    await h.seed.preview();
    const reader = h.as(PUBLIC_READER);
    const lifeNow = async () =>
      publicCacheLife(await reader.listPublishedCompetitions(), h.clock.now());

    // Every move is days away.
    expect(await lifeNow()).toEqual(HOURS);

    const neighbours = await reader.getPublishedCompetition({
      slug: "neighbours-on-my-street",
    });
    const closes = neighbours!.keyDates.find(
      (d) => d.kind === "registration_closes"
    )!.at;

    h.clock.set(new Date(closes.getTime() - 10 * MINUTE_MS));
    expect((await lifeNow()).revalidate).toBe(600);

    // Due, but the worker hasn't drained yet.
    h.clock.set(closes);
    expect((await lifeNow()).revalidate).toBe(60);

    // Moved; the next move (another competition opening) is weeks away.
    await h.drain();
    expect(
      (
        await reader.getPublishedCompetition({
          slug: "neighbours-on-my-street",
        })
      )?.status
    ).toBe("registration_closed");
    expect(await lifeNow()).toEqual(HOURS);
  });
});
