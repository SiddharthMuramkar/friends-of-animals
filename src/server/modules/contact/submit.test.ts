import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { verifyProofOfWork } from "@/lib/proof-of-work";
import type { Actor } from "@/server/actor";
import {
  contactMessage,
  formRateLimit,
  humanCheckRedemption,
  outbox,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { createHarness, type Harness } from "@/test/harness";
import { solvedHumanCheck } from "@/test/human-check";

import { CONTACT_TOPICS, DEFAULT_CONTACT_ROUTING } from "./domain/routing";
import { CONTACT_REFERENCE_PATTERN } from "./domain/submission";

const FORM = {
  topic: "SCHOOLS",
  name: "Asha Rao",
  email: "  Asha.Rao@Example.test ",
  organisation: "Green Valley School, Pune",
  subject: "A competition at our school",
  message: "We would like to bring the competition to classes 6 to 8.",
};

/** Sends the contact form as `actor`, after passing the human check. */
async function send(
  h: Harness,
  actor: Actor,
  fields: Record<string, unknown> = {},
  options: { fillSeconds?: number } = {}
) {
  const humanCheck = await solvedHumanCheck(h, actor, options);
  return h.as(actor).submitContactMessage({ ...FORM, humanCheck, ...fields });
}

async function counts(h: Harness) {
  const [messages, limits, redemptions, events] = await Promise.all([
    h.db.$count(contactMessage),
    h.db.$count(formRateLimit),
    h.db.$count(humanCheckRedemption),
    h.db.$count(outbox),
  ]);
  return { messages, limits, redemptions, events };
}

const NOTHING = { messages: 0, limits: 0, redemptions: 0, events: 0 };

describe("submitContactMessage", () => {
  it("stores a new message on the topic's team and gives a reference", async () => {
    const h = await createHarness();

    const result = await send(h, h.visitor());

    expect(result).toEqual({ ok: true, reference: expect.any(String) });
    const reference = result.ok ? result.reference : "";
    expect(reference).toMatch(CONTACT_REFERENCE_PATTERN);
    expect(reference.startsWith("CM-27-")).toBe(true);
    const rows = await h.db.select().from(contactMessage);
    expect(rows).toEqual([
      expect.objectContaining({
        reference,
        topic: "SCHOOLS",
        team: "competition_manager",
        name: "Asha Rao",
        email: "asha.rao@example.test",
        organisation: "Green Valley School, Pune",
        subject: "A competition at our school",
        message: FORM.message,
        status: "new",
        closeReason: null,
        assignedToUserId: null,
        createdAt: h.clock.now(),
        closedAt: null,
      }),
    ]);
  });

  it("routes every topic to its team", async () => {
    const h = await createHarness();

    for (const [index, topic] of CONTACT_TOPICS.entries()) {
      const visitor = h.visitor({ ip: `192.0.2.${index + 1}` });
      const result = await send(h, visitor, {
        topic,
        email: `sender-${index}@example.test`,
      });
      expect(result.ok).toBe(true);
    }

    const rows = await h.db
      .select({ topic: contactMessage.topic, team: contactMessage.team })
      .from(contactMessage);
    expect(
      Object.fromEntries(rows.map((row) => [row.topic, row.team]))
    ).toEqual(DEFAULT_CONTACT_ROUTING);
  });

  it("refuses a topic outside the seven, such as safeguarding", async () => {
    const h = await createHarness();

    const result = await send(h, h.visitor(), { topic: "SAFEGUARDING" });

    expect(result).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["topic"],
    });
    expect(await counts(h)).toEqual(NOTHING);
  });

  it("names every field that is missing or too long", async () => {
    const h = await createHarness();

    const result = await send(h, h.visitor(), {
      name: " ",
      email: "not an address",
      subject: "x".repeat(151),
    });

    expect(result).toEqual({
      ok: false,
      error: "invalid_input",
      fields: expect.arrayContaining(["name", "email", "subject"]),
    });
    expect(await counts(h)).toEqual(NOTHING);
  });

  it("takes a message from a signed-in member too", async () => {
    const h = await createHarness();
    const member = await h.signIn(await h.seed.member());

    const result = await send(h, member, { topic: "MEDIA" });

    expect(result.ok).toBe(true);
    expect(await h.db.$count(contactMessage)).toBe(1);
  });

  it("is not for the platform's own processes", async () => {
    const h = await createHarness();
    const system: Actor = { kind: "system", process: "worker" };

    await expect(
      h.as(system).submitContactMessage({ ...FORM })
    ).rejects.toThrow(DomainError);
    await expect(h.as(system).issueHumanCheckChallenge()).rejects.toThrow(
      DomainError
    );
  });
});

describe("the human check", () => {
  it("issues a challenge without storing anything", async () => {
    const h = await createHarness();

    const challenge = await h.as(h.visitor()).issueHumanCheckChallenge();

    expect(challenge).toEqual({
      token: expect.any(String),
      salt: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      difficulty: expect.any(Number),
      expiresAt: new Date(h.clock.now().getTime() + 2 * 60 * 60 * 1000),
    });
    expect(await counts(h)).toEqual(NOTHING);
  });

  it("refuses a proof that doesn't solve the challenge", async () => {
    const h = await createHarness();
    const visitor = h.visitor();
    const challenge = await h.as(visitor).issueHumanCheckChallenge();
    let nonce = 0;
    while (await verifyProofOfWork({ ...challenge, nonce })) nonce += 1;
    h.clock.advance({ seconds: 5 });

    const result = await h.as(visitor).submitContactMessage({
      ...FORM,
      humanCheck: { token: challenge.token, nonce },
    });

    expect(result).toEqual({ ok: false, error: "human_check_failed" });
    expect(await counts(h)).toEqual(NOTHING);
  });

  it("refuses a challenge the server didn't sign", async () => {
    const h = await createHarness();
    const visitor = h.visitor();
    const proof = await solvedHumanCheck(h, visitor);
    const [version, salt, issuedAt, difficulty, mac] = proof.token.split(".");
    const easier = [version, salt, issuedAt, "0", mac].join(".");
    expect(difficulty).not.toBe("0");

    const result = await h.as(visitor).submitContactMessage({
      ...FORM,
      humanCheck: { ...proof, token: easier },
    });

    expect(result).toEqual({ ok: false, error: "human_check_failed" });
    expect(await counts(h)).toEqual(NOTHING);
  });

  it("refuses a challenge more than 2 hours old", async () => {
    const h = await createHarness();
    const visitor = h.visitor();
    const proof = await solvedHumanCheck(h, visitor);
    h.clock.advance({ hours: 2, seconds: 1 });

    const result = await h
      .as(visitor)
      .submitContactMessage({ ...FORM, humanCheck: proof });

    expect(result).toEqual({ ok: false, error: "human_check_failed" });
    expect(await counts(h)).toEqual(NOTHING);
  });

  it("spends a proof once", async () => {
    const h = await createHarness();
    const visitor = h.visitor();
    const proof = await solvedHumanCheck(h, visitor);

    const first = await h
      .as(visitor)
      .submitContactMessage({ ...FORM, humanCheck: proof });
    const again = await h
      .as(visitor)
      .submitContactMessage({ ...FORM, humanCheck: proof });

    expect(first.ok).toBe(true);
    expect(again).toEqual({ ok: false, error: "human_check_failed" });
    expect(await h.db.$count(contactMessage)).toBe(1);
  });

  it("refuses a form sent without a proof", async () => {
    const h = await createHarness();

    const result = await h.as(h.visitor()).submitContactMessage({ ...FORM });

    expect(result).toEqual({ ok: false, error: "human_check_failed" });
    expect(await counts(h)).toEqual(NOTHING);
  });
});

describe("the bot screen", () => {
  it("answers a filled hidden field as if it worked, and keeps nothing", async () => {
    const h = await createHarness();

    const result = await send(h, h.visitor(), {
      website: "https://spam.example",
    });

    expect(result).toEqual({ ok: true, reference: expect.any(String) });
    expect(result.ok && result.reference).toMatch(CONTACT_REFERENCE_PATTERN);
    expect(await counts(h)).toEqual(NOTHING);
  });

  it("answers a form sent within 3 seconds as if it worked, and keeps nothing", async () => {
    const h = await createHarness();

    const result = await send(h, h.visitor(), {}, { fillSeconds: 2 });

    expect(result).toEqual({ ok: true, reference: expect.any(String) });
    expect(await counts(h)).toEqual(NOTHING);
  });

  it("takes a form filled in exactly 3 seconds", async () => {
    const h = await createHarness();

    const result = await send(h, h.visitor(), {}, { fillSeconds: 3 });

    expect(result.ok).toBe(true);
    expect(await h.db.$count(contactMessage)).toBe(1);
  });
});

describe("the limits", () => {
  it("refuses a sixth message from one IP within the hour", async () => {
    const h = await createHarness();
    const visitor = h.visitor({ ip: "203.0.113.50" });
    for (let index = 0; index < 5; index++) {
      const result = await send(h, visitor, {
        email: `sender-${index}@example.test`,
      });
      expect(result.ok).toBe(true);
    }

    const sixth = await send(h, visitor, { email: "sender-5@example.test" });

    expect(sixth).toEqual({
      ok: false,
      error: "rate_limited",
      retryAfter: new Date("2027-01-15T05:00:00.000Z"),
      retryAfterSeconds: Math.ceil(
        (Date.parse("2027-01-15T05:00:00.000Z") - h.clock.now().getTime()) /
          1000
      ),
    });
    expect(await h.db.$count(contactMessage)).toBe(5);
  });

  it("refuses a sixth message from one address within the day, whatever the IP", async () => {
    const h = await createHarness();
    for (let index = 0; index < 5; index++) {
      const result = await send(h, h.visitor({ ip: `192.0.2.${index + 1}` }));
      expect(result.ok).toBe(true);
    }

    const sixth = await send(h, h.visitor({ ip: "192.0.2.99" }), {
      email: "ASHA.RAO@example.test",
    });

    expect(sixth).toMatchObject({
      ok: false,
      error: "rate_limited",
      retryAfter: new Date("2027-01-16T00:00:00.000Z"),
    });
    expect(await h.db.$count(contactMessage)).toBe(5);
  });

  it("doesn't count a refused message against the sender", async () => {
    const h = await createHarness();
    const busy = h.visitor({ ip: "203.0.113.60" });
    for (let index = 0; index < 5; index++) {
      await send(h, busy, { email: `sender-${index}@example.test` });
    }
    // Refused by the IP's limit: this address must not lose an allowance.
    const refused = await send(h, busy, { email: "ravi@example.test" });
    expect(refused).toMatchObject({ ok: false, error: "rate_limited" });

    for (let index = 0; index < 5; index++) {
      const result = await send(h, h.visitor({ ip: `198.51.100.${index}` }), {
        email: "ravi@example.test",
      });
      expect(result.ok).toBe(true);
    }
  });

  it("takes messages again once the window has passed", async () => {
    const h = await createHarness();
    const visitor = h.visitor({ ip: "203.0.113.70" });
    for (let index = 0; index < 5; index++) {
      await send(h, visitor, { email: `sender-${index}@example.test` });
    }
    const refused = await send(h, visitor, { email: "late@example.test" });
    expect(refused.ok).toBe(false);
    h.clock.set(new Date("2027-01-15T05:00:00.000Z"));

    const result = await send(h, visitor, { email: "late@example.test" });

    expect(result.ok).toBe(true);
  });

  it("counts an IPv6 sender by its /64 network", async () => {
    const h = await createHarness();
    for (let index = 0; index < 5; index++) {
      await send(h, h.visitor({ ip: `2001:db8:1:2::${index + 1}` }), {
        email: `sender-${index}@example.test`,
      });
    }

    const sixth = await send(h, h.visitor({ ip: "2001:db8:1:2::ff" }), {
      email: "sender-5@example.test",
    });

    expect(sixth).toMatchObject({ ok: false, error: "rate_limited" });
  });
});

describe("what is kept about the sender", () => {
  it("keeps keyed hashes, never the IP, and no address in the limiter", async () => {
    const h = await createHarness();
    const result = await send(h, h.visitor({ ip: "203.0.113.77" }));
    expect(result.ok).toBe(true);

    const dump = async (table: string) => {
      const { rows } = await h.db.execute<{ row: string }>(
        sql`SELECT row_to_json(t)::text AS row FROM ${sql.identifier(table)} t`
      );
      return rows.map((row) => row.row).join("\n");
    };
    const messages = await dump("contact_message");
    const limits = await dump("form_rate_limit");
    const redemptions = await dump("human_check_redemption");

    expect(messages).not.toContain("203.0.113");
    expect(limits).not.toContain("203.0.113");
    expect(limits).not.toContain("asha.rao@example.test");
    expect(redemptions).not.toContain("203.0.113");
    const [row] = await h.db.select().from(contactMessage);
    expect(row?.ipHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
