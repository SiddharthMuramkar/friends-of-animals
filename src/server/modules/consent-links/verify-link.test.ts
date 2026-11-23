import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { consentLink, outbox } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import {
  COMPETITION_TITLE,
  consentLinkWorld,
  deliveredToken,
  GUARDIAN_EMAIL,
} from "./testing";

describe("a guardian opens and verifies a consent link", () => {
  it("opens without writing, then sends a direct code and spends it on verification", async () => {
    const h = await createHarness();
    const world = await consentLinkWorld(h);
    const sent = await world.coordinator.sendConsentLink(world.send);
    if (!sent.ok) throw new Error("Could not send a synthetic link");
    await h.drain();
    const token = deliveredToken(h);
    const visitor = h.as(h.visitor());
    const before = await h.db
      .select()
      .from(consentLink)
      .where(eq(consentLink.id, sent.linkId));
    expect(await visitor.viewConsentLink({ token })).toMatchObject({
      status: "sent",
      childFirstName: "Aanya",
      competitionTitle: COMPETITION_TITLE,
      institutionName: "Test School",
      maskedContact: "g***@example.test",
      uses: [
        {
          purpose: "public_display",
          documentId: world.documents.public_display.id,
          version: 1,
          title: "Draft public_display",
        },
        {
          purpose: "social_media",
          documentId: world.documents.social_media.id,
          version: 1,
          title: "Draft social_media",
        },
      ],
    });
    expect(await visitor.viewConsentLink({ token: "malformed" })).toEqual({
      status: "not_found",
    });
    expect(await visitor.viewConsentLink({ token: "z".repeat(43) })).toEqual({
      status: "not_found",
    });
    const after = await h.db
      .select()
      .from(consentLink)
      .where(eq(consentLink.id, sent.linkId));
    expect(JSON.stringify(after) === JSON.stringify(before)).toBe(true);

    const queued = await h.db.select({ id: outbox.id }).from(outbox);
    expect(await visitor.sendConsentLinkCode({ token })).toEqual({ ok: true });
    const code = h.email.codeFor(GUARDIAN_EMAIL);
    if (!code) throw new Error("Could not find the synthetic code");
    expect(h.email.inbox(GUARDIAN_EMAIL)).toHaveLength(2);
    expect(await h.db.select({ id: outbox.id }).from(outbox)).toEqual(queued);
    expect(await visitor.viewConsentLink({ token })).toMatchObject({
      status: "opened",
    });
    expect(await visitor.sendConsentLinkCode({ token })).toEqual({
      ok: false,
      error: "wait",
      retryAt: new Date(h.clock.now().getTime() + 60_000),
    });
    const session = await visitor.verifyConsentLinkCode({ token, code });
    if (!session.ok) throw new Error(`Could not verify: ${session.error}`);
    expect(session.sessionToken.length).toBe(43);
    expect(session.answerBy.getTime() - h.clock.now().getTime()).toBe(
      1_800_000
    );
    expect(await visitor.verifyConsentLinkCode({ token, code })).toMatchObject({
      ok: false,
    });
    expect(
      await visitor.viewConsentLink({
        token,
        sessionToken: session.sessionToken,
      })
    ).toMatchObject({ status: "verified" });
  });

  it("locks the fifth wrong guess and expires a fresh code at ten minutes", async () => {
    const h = await createHarness();
    const world = await consentLinkWorld(h);
    await world.coordinator.sendConsentLink(world.send);
    await h.drain();
    const token = deliveredToken(h);
    const visitor = h.as(h.visitor());

    await visitor.sendConsentLinkCode({ token });
    const code = h.email.codeFor(GUARDIAN_EMAIL);
    if (!code) throw new Error("Could not find the synthetic code");
    const wrong = code === "000000" ? "111111" : "000000";
    for (const attemptsLeft of [4, 3, 2, 1, 0]) {
      expect(
        await visitor.verifyConsentLinkCode({ token, code: wrong })
      ).toEqual({
        ok: false,
        error: "wrong_code",
        attemptsLeft,
      });
    }
    expect(await visitor.verifyConsentLinkCode({ token, code })).toEqual({
      ok: false,
      error: "code_locked",
    });

    h.clock.advance({ minutes: 1 });
    await visitor.sendConsentLinkCode({ token });
    const fresh = h.email.codeFor(GUARDIAN_EMAIL);
    if (!fresh) throw new Error("Could not find the replacement code");
    h.clock.advance({ minutes: 10 });
    expect(await visitor.verifyConsentLinkCode({ token, code: fresh })).toEqual(
      { ok: false, error: "code_expired" }
    );
  });

  it("caps each link at five codes and the IP at ten across links", async () => {
    const h = await createHarness();
    const world = await consentLinkWorld(h);
    const visitor = h.as(h.visitor({ ip: "203.0.113.55" }));

    for (let link = 0; link < 2; link++) {
      await world.coordinator.sendConsentLink(world.send);
      await h.drain();
      const token = deliveredToken(h);
      for (let code = 0; code < 5; code++) {
        expect(await visitor.sendConsentLinkCode({ token })).toEqual({
          ok: true,
        });
        h.clock.advance({ minutes: 1 });
      }
      expect(await visitor.sendConsentLinkCode({ token })).toEqual({
        ok: false,
        error: "too_many_codes",
      });
    }
    await world.coordinator.sendConsentLink(world.send);
    await h.drain();
    const token = deliveredToken(h);
    expect(await visitor.sendConsentLinkCode({ token })).toMatchObject({
      ok: false,
      error: "rate_limited",
      retryAt: expect.any(Date),
    });
    const otherIp = h.as(h.visitor({ ip: "203.0.113.56" }));
    expect(await otherIp.sendConsentLinkCode({ token })).toEqual({ ok: true });
  });
});

it("uses the captured SMS port when enabled and accepts a signed-in bearer", async () => {
  const h = await createHarness();
  const world = await consentLinkWorld(h);
  const phone = "+919000003081";
  await h.settings.set("sms.enabled", true);
  expect(
    await world.coordinator.sendConsentLink({
      ...world.send,
      channel: "sms",
      address: phone,
    })
  ).toMatchObject({ ok: true, status: "pending" });
  await h.drain();
  const token = /\/consent\/([\w-]{43})/.exec(
    h.sms.lastTo(phone)?.text ?? ""
  )?.[1];
  if (!token) throw new Error("The synthetic text had no link");
  const browser = h.as(await h.signIn(await h.seed.member()));
  expect(await browser.viewConsentLink({ token })).toMatchObject({
    maskedContact: "***3081",
  });
  await h.settings.set("sms.enabled", false);
  expect(await browser.sendConsentLinkCode({ token })).toEqual({
    ok: false,
    error: "sms_disabled",
  });
  await h.settings.set("sms.enabled", true);
  expect(await browser.sendConsentLinkCode({ token })).toEqual({ ok: true });
  const code = /\b\d{6}\b/.exec(h.sms.lastTo(phone)?.text ?? "")?.[0];
  if (!code) throw new Error("The synthetic text had no code");
  expect(await browser.verifyConsentLinkCode({ token, code })).toMatchObject({
    ok: true,
  });
});

it("denies service actors and handles unknown tokens alike for bearer operations", async () => {
  const h = await createHarness();
  const world = await consentLinkWorld(h);
  await world.coordinator.sendConsentLink(world.send);
  await h.drain();
  const token = deliveredToken(h);
  const system = h.as({ kind: "system", process: "cli" });
  await expect(system.viewConsentLink({ token })).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(system.sendConsentLinkCode({ token })).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(
    system.verifyConsentLinkCode({ token, code: "" })
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    system.answerConsentLink({ token, answers: {} })
  ).rejects.toMatchObject({ code: "forbidden" });
  const visitor = h.as(h.visitor());
  for (const unknown of ["bad", "q".repeat(43)]) {
    await expect(visitor.viewConsentLink({ token: unknown })).resolves.toEqual({
      status: "not_found",
    });
    await expect(
      visitor.sendConsentLinkCode({ token: unknown })
    ).resolves.toEqual({ ok: false, error: "not_found" });
    await expect(
      visitor.verifyConsentLinkCode({ token: unknown, code: "" })
    ).resolves.toEqual({ ok: false, error: "not_found" });
    await expect(
      visitor.answerConsentLink({ token: unknown, answers: {} })
    ).resolves.toEqual({ ok: false, error: "not_found" });
  }
  expect(await visitor.viewConsentLink({ token })).toMatchObject({
    status: "sent",
  });
});
