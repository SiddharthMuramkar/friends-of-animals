import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { expect, it } from "vitest";

import { createApp } from "@/server/app";
import { outbox } from "@/server/db/schema";
import { drainUntilIdle } from "@/server/outbox";
import { createHarness } from "@/test/harness";

import catalogue from "../../../../messages/en-IN/guardianConsentDelivery.json";
import { consentLinkWorld, deliveredToken, GUARDIAN_EMAIL } from "./testing";

it("delivers the seeded guardian link and direct code using the message catalogue", async () => {
  const h = await createHarness();
  const world = await consentLinkWorld(h);
  const issued = await world.coordinator.sendConsentLink(world.send);
  if (!issued.ok) throw new Error("Could not issue the synthetic link");
  await h.drain();
  const token = deliveredToken(h);
  const linkMail = h.email.lastTo(GUARDIAN_EMAIL);
  expect(await h.as(h.visitor()).sendConsentLinkCode({ token })).toEqual({
    ok: true,
  });
  const codeMail = h.email.lastTo(GUARDIAN_EMAIL);
  const code = h.email.codeFor(GUARDIAN_EMAIL);
  if (!code) throw new Error("No synthetic code arrived");

  const { link } = catalogue.guardianConsentDelivery;
  const codeWords = createTranslator({
    locale: "en-IN",
    messages: catalogue,
    namespace: "guardianConsentDelivery.code",
  });
  const url = new URL(`/consent/${token}`, h.deps.auth.baseUrl).href;
  expect(linkMail?.subject).toBe(link.email.subject);
  expect(linkMail?.text === link.email.text.replace("{{link}}", url)).toBe(
    true
  );
  expect(codeMail?.subject).toBe(codeWords("subject"));
  expect(codeMail?.text === codeWords("text", { code, minutes: 10 })).toBe(
    true
  );
});

it.each(["staging", "production"] as const)(
  "keeps queued deliveries and existing consent links inactive in %s",
  async (appEnv) => {
    const h = await createHarness();
    const world = await consentLinkWorld(h);
    await h.settings.set("sms.enabled", true);
    const queued = await world.coordinator.sendConsentLink(world.send);
    if (!queued.ok) throw new Error("Could not issue the synthetic link");

    const inactive = { ...h.deps, appEnv };
    await drainUntilIdle(inactive, { queue: "all" });
    const [delivery] = await h.db
      .select({ dispatchedAt: outbox.dispatchedAt })
      .from(outbox)
      .where(eq(outbox.aggregateId, queued.linkId));
    expect(delivery?.dispatchedAt).toEqual(h.clock.now());
    expect(h.email.inbox(GUARDIAN_EMAIL)).toHaveLength(0);

    const issued = await world.coordinator.sendConsentLink(world.send);
    if (!issued.ok) throw new Error("Could not issue the replacement link");
    await h.drain();
    const token = deliveredToken(h);
    const actor = h.visitor();
    const local = h.as(actor);
    const deployed = createApp(inactive).as(actor);
    expect(await deployed.viewConsentLink({ token })).toEqual({
      status: "not_found",
    });
    const notFound = { ok: false, error: "not_found" };
    expect(await deployed.sendConsentLinkCode({ token })).toEqual(notFound);
    expect(await local.sendConsentLinkCode({ token })).toEqual({ ok: true });
    const code = h.email.codeFor(GUARDIAN_EMAIL);
    if (!code) throw new Error("No synthetic code arrived");
    expect(await deployed.verifyConsentLinkCode({ token, code })).toEqual(
      notFound
    );
    const verified = await local.verifyConsentLinkCode({ token, code });
    if (!verified.ok) throw new Error("Could not verify the synthetic code");
    const { sessionToken } = verified;
    const answers = { public_display: "give", social_media: "decline" };
    expect(
      await deployed.answerConsentLink({ token, sessionToken, answers })
    ).toEqual(notFound);
    expect(await local.viewConsentLink({ token, sessionToken })).toMatchObject({
      status: "verified",
    });
  }
);
