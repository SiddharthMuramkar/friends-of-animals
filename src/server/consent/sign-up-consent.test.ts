import { count } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, consentEvent } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

const SOURCE = [
  "- We email you news about competitions.",
  "",
  "## What you agree to {#what-you-agree-to}",
  "",
  "News and updates by email.",
].join("\n");

let publishers = 0;

async function publishMessages(h: Harness) {
  publishers += 1;
  const admin = await h.seed.superAdmin({
    email: `sign-up-publisher-${publishers}@example.test`,
  });
  const published = await h.as(await h.signIn(admin)).publishConsentDocument({
    purpose: "messages",
    title: "News",
    source: SOURCE,
  });
  if (!published.ok) throw new Error("Could not publish");
  return published;
}

const ASHA = { name: "Asha Rao", email: "asha@example.test" };

/** Signs up through the real email-code flow, as the sign-up form does. */
async function signUp(h: Harness, messagesConsent?: string) {
  const visitor = h.visitor({
    ip: "198.51.100.61",
    userAgent: "Sign-up browser",
  });
  await h.as(visitor).requestEmailCode({ intent: "sign-up", ...ASHA });
  const code = h.email.codeFor(ASHA.email) ?? "";
  return h.as(visitor).verifyEmailCode({
    intent: "sign-up",
    ...ASHA,
    code,
    ...(messagesConsent === undefined ? {} : { messagesConsent }),
  });
}

describe("sign-up with the messages consent box", () => {
  it("ticked, records consent to the version shown, by web form", async () => {
    const h = await createHarness();
    const document = await publishMessages(h);

    const result = await signUp(h, document.id);

    expect(result).toEqual({
      ok: true,
      userId: expect.any(String),
      isNewAccount: true,
      messagesConsent: "given",
    });
    const member = await h.currentActor();
    const [messages] = await h.as(member).myConsents();
    expect(messages?.state).toEqual({
      status: "given",
      documentId: document.id,
      documentVersion: 1,
      since: h.clock.now(),
    });
    expect(messages?.history).toEqual([
      expect.objectContaining({ action: "given", method: "web_form" }),
    ]);
    const userId = result.ok ? result.userId : "";
    expect(await h.db.select().from(consentEvent)).toEqual([
      expect.objectContaining({ subjectId: userId, giverUserId: userId }),
    ]);
    const entries = await h.db.select().from(auditLog);
    expect(entries.filter((e) => e.action === "consent.given")).toEqual([
      expect.objectContaining({
        actorKind: "visitor",
        entityType: "consent_event",
        ip: "198.51.100.61",
        userAgent: "Sign-up browser",
      }),
    ]);
  });

  it("unticked, records nothing", async () => {
    const h = await createHarness();
    await publishMessages(h);

    const result = await signUp(h);

    expect(result).toEqual({
      ok: true,
      userId: expect.any(String),
      isNewAccount: true,
    });
    const [events] = await h.db.select({ n: count() }).from(consentEvent);
    expect(events?.n).toBe(0);
    const [messages] = await h.as(await h.currentActor()).myConsents();
    expect(messages?.state).toEqual({ status: "never" });
  });

  it("ticked on a version replaced meanwhile, creates the account and records nothing", async () => {
    const h = await createHarness();
    const shown = await publishMessages(h);
    await publishMessages(h);

    const result = await signUp(h, shown.id);

    expect(result).toEqual({
      ok: true,
      userId: expect.any(String),
      isNewAccount: true,
      messagesConsent: "document_outdated",
    });
    const [events] = await h.db.select({ n: count() }).from(consentEvent);
    expect(events?.n).toBe(0);
  });
});
