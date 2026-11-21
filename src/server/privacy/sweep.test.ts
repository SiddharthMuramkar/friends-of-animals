import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { session } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

const WORKER: Actor = { kind: "system", process: "worker" };

function sessionIdOf(actor: Actor): string {
  if (actor.kind !== "user") throw new Error("not signed in");
  return actor.sessionId;
}

async function sessionIds(h: Harness): Promise<string[]> {
  const rows = await h.db.select({ id: session.id }).from(session);
  return rows.map((row) => row.id).sort();
}

/**
 * A member signed in twice, a second apart, then the clock moved to 30
 * days after the first session expired: that one's period is over, the
 * other's ends a second later.
 */
async function sessionsAtTheBoundary(h: Harness) {
  const member = await h.seed.member();
  const expired = await h.signIn(member);
  h.clock.advance({ seconds: 1 });
  h.cookies.clear();
  const kept = await h.signIn(member);
  // Sessions last 30 days; the policy keeps an expired one 30 more.
  h.clock.advance({ days: 60, seconds: -1 });
  return { member, expired, kept };
}

describe("runRetentionSweep", () => {
  it("deletes a session 30 days after it expired, not a second sooner", async () => {
    const h = await createHarness();
    const { kept } = await sessionsAtTheBoundary(h);

    await h.as(WORKER).runRetentionSweep();

    expect(await sessionIds(h)).toEqual([sessionIdOf(kept)]);
  });
});
