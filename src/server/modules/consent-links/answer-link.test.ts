import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, consentLink } from "@/server/db/schema";
import { sqlState } from "@/server/errors";
import { signInManager } from "@/server/modules/competitions/terms/testing";
import {
  consentRows,
  publishNextVersion,
} from "@/server/modules/consent/testing";
import { signedInStaff } from "@/server/modules/institutions/testing";
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
    // A new publication does not change the competition's attached version.
    const next = await publishNextVersion(h, "public_display");

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

    const manager = h.as(await signInManager(h));
    expect(
      await manager.attachConsentDocument({
        competitionId: world.competition.id,
        purpose: "public_display",
      })
    ).toMatchObject({ ok: true, changed: true, document: { id: next.id } });
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
    expect(withdrawn.outbox.map(({ handler }) => handler).sort()).toEqual([
      "gallery.withdraw_consent",
      "notifications.dispatch",
    ]);
    for (const delivery of withdrawn.outbox) {
      expect(delivery.payload).toEqual({
        subjectType: "participant_profile",
        subjectId: world.studentId,
        competitionId: world.competition.id,
        consentEventId: withdrawn.events.at(-1)?.id,
        purpose: "public_display",
        documentId: world.documents.public_display.id,
      });
    }
  });

  it("refuses stale choices after a document is repinned and lets the school replace the link", async () => {
    const h = await createHarness();
    const world = await consentLinkWorld(h);
    const old = await verifiedLink(h, world);
    const visitor = h.as(h.visitor());
    const { institutionId, registrationId, competition } = world;
    const query = { institutionId, registrationId };
    expect(await visitor.viewConsentLink(old)).toMatchObject({
      status: "verified",
      uses: expect.arrayContaining([
        expect.objectContaining({
          purpose: "public_display",
          documentId: world.documents.public_display.id,
          version: world.documents.public_display.version,
        }),
      ]),
    });

    const next = await publishNextVersion(h, "public_display");
    const manager = h.as(await signInManager(h));
    expect(
      await manager.attachConsentDocument({
        competitionId: competition.id,
        purpose: "public_display",
      })
    ).toMatchObject({ ok: true, changed: true, document: { id: next.id } });

    await expect
      .soft(visitor.answerConsentLink({ ...old, answers }))
      .resolves.toEqual({
        ok: false,
        error: "stale_request",
      });
    const { events, audit, outbox } = await consentRows(h);
    expect
      .soft([events.length, audit.length, outbox.length])
      .toEqual([0, 0, 0]);
    expect
      .soft(await world.coordinator.listStudentConsents(query))
      .toMatchObject({
        ok: true,
        students: [
          {
            publicUse: "none",
            given: [],
            canSendLink: true,
            revocableLinkId: old.linkId,
          },
        ],
      });

    const replacement = await verifiedLink(h, world);
    expect(await visitor.viewConsentLink(old)).toEqual({ status: "revoked" });
    expect(await visitor.viewConsentLink(replacement)).toMatchObject({
      status: "verified",
      uses: expect.arrayContaining([
        expect.objectContaining({
          purpose: "public_display",
          documentId: next.id,
          version: next.version,
        }),
      ]),
    });
    expect(
      await visitor.answerConsentLink({ ...replacement, answers })
    ).toEqual({ ok: true });
    expect(
      (await consentRows(h)).events.map(({ documentId }) => documentId)
    ).toEqual([next.id]);
    expect(await world.coordinator.listStudentConsents(query)).toMatchObject({
      ok: true,
      students: [
        { link: "answered", publicUse: "some", given: ["public_display"] },
      ],
    });
  });

  it("keeps a suspended school's link unavailable until the school is reinstated", async () => {
    const h = await createHarness();
    const world = await consentLinkWorld(h);
    const verified = await verifiedLink(h, world);
    const visitor = h.as(h.visitor());
    const staff = h.as(await signedInStaff(h));
    const decision = {
      institutionId: world.institutionId,
      reason: "Synthetic review",
    };
    expect(
      await staff.decideInstitution({ ...decision, decision: "suspend" })
    ).toMatchObject({ ok: true, status: "suspended" });
    const [before] = await h.db
      .select()
      .from(consentLink)
      .where(eq(consentLink.id, verified.linkId));
    const messageCount = h.email.sent.length;

    expect
      .soft(await visitor.viewConsentLink(verified))
      .toEqual({ status: "not_found" });
    const unavailable = { ok: false, error: "not_found" };
    expect
      .soft(await visitor.sendConsentLinkCode(verified))
      .toEqual(unavailable);
    expect
      .soft(await visitor.verifyConsentLinkCode(verified))
      .toEqual(unavailable);
    expect
      .soft(await visitor.answerConsentLink({ ...verified, answers }))
      .toEqual(unavailable);
    expect
      .soft(await visitor.answerConsentLink({ token: verified.token, answers }))
      .toEqual(unavailable);
    const [after] = await h.db
      .select()
      .from(consentLink)
      .where(eq(consentLink.id, verified.linkId));
    expect(before?.status).toBe("pending");
    expect(JSON.stringify(after) === JSON.stringify(before)).toBe(true);
    expect(h.email.sent).toHaveLength(messageCount);
    expect((await consentRows(h)).events).toHaveLength(0);

    expect(
      await staff.decideInstitution({ ...decision, decision: "verify" })
    ).toMatchObject({ ok: true, outcome: "reinstated" });
    expect(await visitor.viewConsentLink(verified)).toMatchObject({
      status: "verified",
    });
    expect(await visitor.answerConsentLink({ ...verified, answers })).toEqual({
      ok: true,
    });
  });

  it("rolls back every choice on a database failure and reports only a safe diagnostic", async () => {
    const h = await createHarness();
    const world = await consentLinkWorld(h);
    const verified = await verifiedLink(h, world);
    const visitor = h.as(h.visitor());
    // Fail the second evidence insert after the first event and its audit.
    await h.db.$client.exec(`
      ALTER TABLE consent_event ADD CONSTRAINT test_refuse_social_consent
      CHECK (purpose <> 'social_media')
    `);
    const input = {
      ...verified,
      answers: { ...answers, social_media: "give" },
    };
    const result = await visitor
      .answerConsentLink(input)
      .catch((error: unknown) => ({ uncaught: sqlState(error) }));
    expect.soft(result).toEqual({ ok: false, error: "save_failed" });
    expect.soft(h.errors.reported).toMatchObject([
      {
        message: "Could not save consent link choices",
        tags: { where: "answerConsentLink", sqlState: "23514" },
        extra: {},
      },
    ]);
    const [diagnostic] = h.errors.reported;
    expect
      .soft(
        diagnostic?.error instanceof Error && !("cause" in diagnostic.error)
      )
      .toBe(true);
    const [link] = await h.db
      .select({ contactHash: consentLink.contactHash })
      .from(consentLink)
      .where(eq(consentLink.id, verified.linkId));
    const output = JSON.stringify(h.errors.reported);
    for (const value of [
      world.studentId,
      verified.linkId,
      verified.token,
      verified.sessionToken,
      link?.contactHash,
      "social_media",
    ]) {
      expect(Boolean(value && output.includes(value))).toBe(false);
    }
    expect(await consentRows(h)).toMatchObject({
      events: [],
      audit: [],
      outbox: [],
    });
    expect(await visitor.viewConsentLink(verified)).toMatchObject({
      status: "verified",
    });

    await h.db.$client.exec(
      "ALTER TABLE consent_event DROP CONSTRAINT test_refuse_social_consent"
    );
    expect(await visitor.answerConsentLink(input)).toEqual({ ok: true });
    expect((await consentRows(h)).events).toHaveLength(2);
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
    const issued = await world.coordinator.sendConsentLink(world.send);
    if (!issued.ok) throw new Error("Could not issue the synthetic link");
    await h.drain();
    const token = deliveredToken(h);
    const visitor = h.as(h.visitor());
    h.clock.advance({ days: 7, minutes: -1 });
    await visitor.sendConsentLinkCode({ token });
    const code = h.email.codeFor(GUARDIAN_EMAIL);
    if (!code) throw new Error("No synthetic code arrived");
    const checked = await visitor.verifyConsentLinkCode({ token, code });
    if (!checked.ok) throw new Error("Could not verify the synthetic code");
    expect(checked.answerBy).toEqual(issued.expiresAt);
    expect(
      await visitor.viewConsentLink({
        token,
        sessionToken: checked.sessionToken,
      })
    ).toMatchObject({ status: "verified", answerBy: issued.expiresAt });
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
