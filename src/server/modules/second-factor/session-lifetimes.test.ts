import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { session } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import type { Actor } from "../../actor";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function sessionId(actor: Actor): string {
  if (actor.kind !== "user") throw new Error("Not signed in");
  return actor.sessionId;
}

async function storedExpiry(h: Harness, actor: Actor) {
  const [row] = await h.db
    .select({ expiresAt: session.expiresAt })
    .from(session)
    .where(eq(session.id, sessionId(actor)));
  return row?.expiresAt;
}

/** Who the server sees for the browser holding `cookie`. */
async function seenAs(h: Harness, cookie: string) {
  return (await h.currentActor(undefined, cookie)).kind;
}

describe("session lifetimes", () => {
  it("ends a staff session 12 hours after sign-in", async () => {
    const h = await createHarness();
    const signedInAt = h.clock.now().getTime();
    const actor = await h.signIn(await h.seed.superAdmin());
    const browser = h.cookies.header();

    expect(await storedExpiry(h, actor)).toEqual(
      new Date(signedInAt + 12 * HOUR)
    );
    h.clock.advance({ hours: 11, minutes: 59 });
    expect(await seenAs(h, browser)).toBe("user");
    h.clock.advance({ minutes: 1 });
    expect(await seenAs(h, browser)).toBe("visitor");
  });

  it("keeps a member signed in for 30 days", async () => {
    const h = await createHarness();
    const signedInAt = h.clock.now().getTime();
    const actor = await h.signIn(await h.seed.member());
    const browser = h.cookies.header();

    expect(await storedExpiry(h, actor)).toEqual(
      new Date(signedInAt + 30 * DAY)
    );
    h.clock.advance({ days: 29, hours: 23 });
    expect(await seenAs(h, browser)).toBe("user");
    h.clock.advance({ hours: 1 });
    expect(await seenAs(h, browser)).toBe("visitor");
  });

  it("shortens the live sessions of someone granted a staff role", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const oldSession = await h.signIn(member);
    const oldBrowser = h.cookies.header();
    h.clock.advance({ hours: 13 });
    const newSession = await h.signIn(member);
    const newBrowser = h.cookies.header();
    const newSignIn = h.clock.now().getTime();
    const admin = await h.signIn(await h.seed.superAdmin());

    expect(
      await h.as(admin).grantRole({
        userId: member.id,
        role: "finance",
        scope: { type: "global" },
      })
    ).toMatchObject({ ok: true, changed: true });

    // Signed in 13 hours ago: past a staff session's 12 hours.
    expect(await seenAs(h, oldBrowser)).toBe("visitor");
    expect(await storedExpiry(h, newSession)).toEqual(
      new Date(newSignIn + 12 * HOUR)
    );
    expect(await seenAs(h, newBrowser)).toBe("user");
    expect(sessionId(oldSession)).not.toBe(sessionId(newSession));
  });

  it("leaves sessions alone when the role granted isn't staff", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const signedInAt = h.clock.now().getTime();
    const actor = await h.signIn(member);
    const admin = await h.signIn(await h.seed.superAdmin());

    await h.as(admin).grantRole({
      userId: member.id,
      role: "judge",
      scope: { type: "global" },
    });

    expect(await storedExpiry(h, actor)).toEqual(
      new Date(signedInAt + 30 * DAY)
    );
  });

  it("ends a staff session after 12 hours even if its stored expiry is later", async () => {
    const h = await createHarness();
    const actor = await h.signIn(await h.seed.superAdmin());
    const browser = h.cookies.header();
    // As if a refresh had pushed the expiry out again.
    await h.db
      .update(session)
      .set({ expiresAt: new Date(h.clock.now().getTime() + 30 * DAY) })
      .where(eq(session.id, sessionId(actor)));

    h.clock.advance({ hours: 12 });

    expect(await seenAs(h, browser)).toBe("visitor");
  });
});
