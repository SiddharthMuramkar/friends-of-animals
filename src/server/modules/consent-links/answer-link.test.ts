import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, consentLink } from "@/server/db/schema";
import {
  consentRows,
  publishNextVersion,
  reattach,
} from "@/server/modules/consent/testing";
import { createHarness, type Harness } from "@/test/harness";

import { consentLinkWorld, deliveredToken, GUARDIAN_EMAIL } from "./testing";

const answers = { public_display: "give", social_media: "decline" } as const;

async function verifiedLink(
  h: Harness,
  world: Awaited<ReturnType<typeof consentLinkWorld>>
) {
  const sent = await world.coordinator.sendConsentLink(world.send);
  if (!sent.ok) throw new Error(`Could not send: ${sent.error}`);
  await h.drain();
  const token = deliveredToken(h);
  const visitor = h.as(h.visitor());
  await visitor.sendConsentLinkCode({ token });
  const code = h.email.codeFor(GUARDIAN_EMAIL);
  if (!code) throw new Error("No synthetic code arrived");
  const verified = await visitor.verifyConsentLinkCode({ token, code });
  if (!verified.ok) throw new Error(`Could not verify: ${verified.error}`);
  return {
    linkId: sent.linkId,
    token,
    code,
    sessionToken: verified.sessionToken,
  };
}

describe("answerConsentLink", () => {
  it("records the shown version with contact evidence once, then withdraws it from a new link", async () => {
    const h = await createHarness();
    const world = await consentLinkWorld(h);
    const { linkId, code, ...credentials } = await verifiedLink(h, world);
    const member = await h.seed.member();
    const browser = h.as(await h.signIn(member));
    const shown = await browser.viewConsentLink(credentials);
    expect(shown).toMatchObject({
      uses: [
        { documentId: world.documents.public_display.id },
        { documentId: world.documents.social_media.id },
      ],
    });
    const next = await publishNextVersion(h, "public_display");
    await reattach(h, world.competition.id, "public_display", next.id);

    const input = { ...credentials, answers };
    expect(await browser.answerConsentLink(input)).toEqual({ ok: true });
    const visitor = h.as(h.visitor());
    expect(await visitor.answerConsentLink(input)).toEqual({
      ok: false,
      error: "already_used",
    });
    expect(await visitor.viewConsentLink(credentials)).toEqual({
      status: "used",
    });
    expect(await visitor.sendConsentLinkCode(credentials)).toEqual({
      ok: false,
      error: "already_used",
    });
    expect(
      await visitor.verifyConsentLinkCode({ token: credentials.token, code })
    ).toEqual({ ok: false, error: "already_used" });

    const { events, outbox, audit } = await consentRows(h);
    const [saved] = await h.db
      .select()
      .from(consentLink)
      .where(eq(consentLink.id, linkId));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      subjectType: "participant_profile",
      subjectId: world.studentId,
      competitionId: world.competition.id,
      purpose: "public_display",
      documentId: world.documents.public_display.id,
      giverUserId: null,
      giverContactHash: expect.any(String),
      consentLinkId: linkId,
      action: "given",
      method: "otp_link",
      occurredAt: h.clock.now(),
    });
    expect(events[0]?.giverContactHash === saved?.contactHash).toBe(true);
    expect(JSON.stringify(events).includes(GUARDIAN_EMAIL)).toBe(false);
    expect(audit).toMatchObject([
      { action: "consent.given", actorUserId: null },
    ]);
    expect(outbox).toHaveLength(0);
    expect(saved).toMatchObject({
      status: "used",
      usedAt: h.clock.now(),
      answers,
      tokenCiphertext: null,
      codeHash: null,
      sessionTokenHash: null,
    });
    const linkAudit = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, linkId));
    expect(linkAudit.map(({ action }) => action).sort()).toEqual([
      "consent_link.answered",
      "consent_link.sent",
    ]);
    expect(JSON.stringify(linkAudit).includes(credentials.token)).toBe(false);

    const renewed = await verifiedLink(h, world);
    expect(
      await visitor.answerConsentLink({
        token: renewed.token,
        sessionToken: renewed.sessionToken,
        answers: { public_display: "decline", social_media: "decline" },
      })
    ).toEqual({ ok: true });
    const withdrawn = await consentRows(h);
    expect(withdrawn.events).toHaveLength(2);
    expect(withdrawn.events.at(-1)).toMatchObject({
      action: "withdrawn",
      documentId: world.documents.public_display.id,
      method: "otp_link",
      consentLinkId: renewed.linkId,
    });
    expect(withdrawn.outbox).toMatchObject([
      {
        payload: {
          subjectId: world.studentId,
          purpose: "public_display",
          documentId: world.documents.public_display.id,
        },
      },
    ]);
  });

  it("keeps the link open when answers or the answer session are invalid", async () => {
    const h = await createHarness();
    const world = await consentLinkWorld(h);
    const first = await verifiedLink(h, world);
    const visitor = h.as(h.visitor());
    expect(
      await visitor.answerConsentLink({ token: first.token, answers })
    ).toEqual({ ok: false, error: "not_verified" });
    for (const [submitted, error] of [
      [{ public_display: "give" }, "unanswered"],
      [{ ...answers, participation: "give" }, "not_offered"],
      [{ ...answers, public_display: true }, "invalid_answer"],
    ] as const) {
      expect(
        await visitor.answerConsentLink({
          token: first.token,
          sessionToken: first.sessionToken,
          answers: submitted,
        })
      ).toEqual({ ok: false, error });
    }
    expect(await visitor.viewConsentLink(first)).toMatchObject({
      status: "verified",
    });
    expect((await consentRows(h)).events).toHaveLength(0);

    h.clock.advance({ minutes: 30 });
    expect(await visitor.answerConsentLink({ ...first, answers })).toEqual({
      ok: false,
      error: "window_closed",
    });
    const second = await verifiedLink(h, world);
    expect(
      await visitor.answerConsentLink({
        token: second.token,
        sessionToken: first.sessionToken,
        answers,
      })
    ).toEqual({ ok: false, error: "not_verified" });
    expect(
      await visitor.answerConsentLink({
        ...second,
        token: "q".repeat(43),
        answers,
      })
    ).toEqual({ ok: false, error: "not_found" });
    expect((await consentRows(h)).events).toHaveLength(0);
  });

  it("expires at seven days even if the answer session was verified just before expiry", async () => {
    const h = await createHarness();
    const world = await consentLinkWorld(h);
    await world.coordinator.sendConsentLink(world.send);
    await h.drain();
    const token = deliveredToken(h);
    const visitor = h.as(h.visitor());
    h.clock.advance({ days: 7, minutes: -1 });
    await visitor.sendConsentLinkCode({ token });
    const code = h.email.codeFor(GUARDIAN_EMAIL);
    if (!code) throw new Error("No synthetic code arrived");
    const checked = await visitor.verifyConsentLinkCode({ token, code });
    if (!checked.ok) throw new Error("Could not verify the synthetic code");
    h.clock.advance({ minutes: 1 });

    expect(await visitor.viewConsentLink({ token })).toEqual({
      status: "expired",
    });
    expect(await visitor.sendConsentLinkCode({ token })).toEqual({
      ok: false,
      error: "expired",
    });
    expect(await visitor.verifyConsentLinkCode({ token, code })).toEqual({
      ok: false,
      error: "expired",
    });
    expect(
      await visitor.answerConsentLink({
        token,
        sessionToken: checked.sessionToken,
        answers,
      })
    ).toEqual({ ok: false, error: "expired" });
    expect((await consentRows(h)).events).toHaveLength(0);
  });
});

it("commits only one answer when the same verified browser submits twice", async () => {
  const h = await createHarness();
  const world = await consentLinkWorld(h);
  const verified = await verifiedLink(h, world);
  const visitor = h.as(h.visitor());
  const input = {
    token: verified.token,
    sessionToken: verified.sessionToken,
    answers,
  };
  const results = await Promise.all([
    visitor.answerConsentLink(input),
    visitor.answerConsentLink(input),
  ]);
  expect(results).toContainEqual({ ok: true });
  expect(results).toContainEqual({ ok: false, error: "already_used" });
  expect((await consentRows(h)).events).toHaveLength(1);
});
