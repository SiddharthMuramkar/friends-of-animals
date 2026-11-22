// Seam 1 for channels (#69): each user's email and SMS choices, messages
// the law requires, the SMS switch and DLT registration, and email plus
// in-app covering for an SMS that doesn't go out.

import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  inboxItem,
  messageDelivery,
  messageRoute,
  messageTemplate,
} from "@/server/db/schema";
import { emit } from "@/server/outbox";
import { createHarness, type Harness } from "@/test/harness";

const PHONE = "+919876543210";
const DLT_ID = "1107170000000000001";

type Channel = "email" | "sms" | "in_app";

/** The welcome route, re-pointed for a test. */
async function welcomeRoute(
  h: Harness,
  route: { channels: Channel[]; requiredByLaw: boolean }
) {
  await h.db
    .update(messageRoute)
    .set(route)
    .where(eq(messageRoute.templateKey, "identity.welcome"));
}

/** Gives the welcome SMS its DLT registration. */
async function registerWelcomeSms(h: Harness) {
  await h.db
    .update(messageTemplate)
    .set({ dltTemplateId: DLT_ID })
    .where(
      and(
        eq(messageTemplate.key, "identity.welcome"),
        eq(messageTemplate.channel, "sms")
      )
    );
}

/** A member with an email and a verified phone, signed in. */
async function memberWithPhone(h: Harness) {
  const account = await h.seed.member({ name: "Asha Rao", phone: PHONE });
  return { account, actor: await h.signIn(account) };
}

/** What a sign-up emits, for an account seeded without one. */
async function welcome(h: Harness, userId: string) {
  await emit(h.db, h.clock, {
    type: "identity.user_signed_up",
    aggregate: { type: "user", id: userId },
    payload: { userId },
  });
  await h.drain();
}

function welcomeEmailsTo(h: Harness, email: string) {
  return h.email.sent.filter(
    (message) =>
      message.to === email &&
      message.subject === "Welcome to Friends of Animals"
  );
}

async function inboxCount(h: Harness, userId: string) {
  return (
    await h.db.select().from(inboxItem).where(eq(inboxItem.userId, userId))
  ).length;
}

async function deliveries(h: Harness, userId: string) {
  return h.db
    .select({
      channel: messageDelivery.channel,
      status: messageDelivery.status,
      reason: messageDelivery.reason,
    })
    .from(messageDelivery)
    .where(eq(messageDelivery.userId, userId));
}

describe("getNotificationPreferences and updateNotificationPreferences", () => {
  it("starts with email and SMS on, and keeps a user's choice", async () => {
    const h = await createHarness();
    const { actor } = await memberWithPhone(h);

    expect(await h.as(actor).getNotificationPreferences()).toEqual({
      email: true,
      sms: true,
    });
    expect(
      await h
        .as(actor)
        .updateNotificationPreferences({ email: true, sms: false })
    ).toEqual({ ok: true, preferences: { email: true, sms: false } });
    expect(await h.as(actor).getNotificationPreferences()).toEqual({
      email: true,
      sms: false,
    });
  });

  it("refuses turning both channels off", async () => {
    const h = await createHarness();
    const { actor } = await memberWithPhone(h);

    expect(
      await h
        .as(actor)
        .updateNotificationPreferences({ email: false, sms: false })
    ).toEqual({ ok: false, error: "invalid_input", fields: ["email", "sms"] });
    expect(await h.as(actor).getNotificationPreferences()).toEqual({
      email: true,
      sms: true,
    });
  });

  it("refuses a visitor", async () => {
    const h = await createHarness();
    const app = h.as(h.visitor());

    await expect(app.getNotificationPreferences()).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      app.updateNotificationPreferences({ email: true, sms: true })
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("a user who turns SMS off", () => {
  it("gets the email but no SMS for an ordinary message", async () => {
    const h = await createHarness();
    await h.settings.set("sms.enabled", true);
    await registerWelcomeSms(h);
    await welcomeRoute(h, { channels: ["email", "sms"], requiredByLaw: false });
    const { account, actor } = await memberWithPhone(h);
    await h
      .as(actor)
      .updateNotificationPreferences({ email: true, sms: false });

    await welcome(h, account.id);

    expect(h.sms.sent).toEqual([]);
    expect(welcomeEmailsTo(h, account.email)).toHaveLength(1);
    expect(await deliveries(h, account.id)).toContainEqual({
      channel: "sms",
      status: "suppressed",
      reason: "preference_off",
    });
  });

  it("still gets the SMS for a message the law requires", async () => {
    const h = await createHarness();
    await h.settings.set("sms.enabled", true);
    await registerWelcomeSms(h);
    await welcomeRoute(h, { channels: ["email", "sms"], requiredByLaw: true });
    const { account, actor } = await memberWithPhone(h);
    await h
      .as(actor)
      .updateNotificationPreferences({ email: true, sms: false });

    await welcome(h, account.id);

    expect(h.sms.sent).toEqual([
      expect.objectContaining({
        to: PHONE,
        template: "message",
        dltTemplateId: DLT_ID,
        text: "Welcome to Friends of Animals, Asha Rao. Thank you for creating an account.",
      }),
    ]);
    expect(welcomeEmailsTo(h, account.email)).toHaveLength(1);
  });
});

describe("with the SMS switch off", () => {
  it("sends no SMS for ordinary or required messages, even with SMS chosen", async () => {
    const h = await createHarness();
    await registerWelcomeSms(h);
    const { account } = await memberWithPhone(h);

    for (const requiredByLaw of [false, true]) {
      await welcomeRoute(h, { channels: ["email", "sms"], requiredByLaw });
      await welcome(h, account.id);
    }

    expect(h.sms.sent).toEqual([]);
    expect(welcomeEmailsTo(h, account.email)).toHaveLength(2);
  });

  it("covers an SMS-only message with an email and an inbox item", async () => {
    const h = await createHarness();
    await registerWelcomeSms(h);
    await welcomeRoute(h, { channels: ["sms"], requiredByLaw: false });
    const { account } = await memberWithPhone(h);

    await welcome(h, account.id);

    expect(h.sms.sent).toEqual([]);
    expect(welcomeEmailsTo(h, account.email)).toHaveLength(1);
    expect(await inboxCount(h, account.id)).toBe(1);
    expect(await deliveries(h, account.id)).toContainEqual({
      channel: "sms",
      status: "suppressed",
      reason: "sms_disabled",
    });
  });
});

// The switch staff flip is #62's runtime setting sms.enabled on
// /admin/settings: the dispatcher reads that row, so a change applies to
// the next message, with no deploy.
describe("the SMS switch on the settings screen", () => {
  it("stops SMS once a super admin switches it off, though it was on", async () => {
    const h = await createHarness();
    // On, as the preview seed stores it for previews and local runs.
    await h.settings.set("sms.enabled", true);
    await registerWelcomeSms(h);
    await welcomeRoute(h, { channels: ["email", "sms"], requiredByLaw: false });
    const { account } = await memberWithPhone(h);
    const admin = await h.signIn(await h.seed.superAdmin());

    expect(
      await h.as(admin).changeSetting({ key: "sms.enabled", value: false })
    ).toMatchObject({ ok: true });
    await welcome(h, account.id);

    expect(h.sms.sent).toEqual([]);
    expect(welcomeEmailsTo(h, account.email)).toHaveLength(1);
    expect(await deliveries(h, account.id)).toContainEqual({
      channel: "sms",
      status: "suppressed",
      reason: "sms_disabled",
    });
  });

  it("lets a registered SMS go once a super admin switches it on, though it starts off", async () => {
    const h = await createHarness();
    await registerWelcomeSms(h);
    await welcomeRoute(h, { channels: ["email", "sms"], requiredByLaw: false });
    const { account } = await memberWithPhone(h);
    const admin = await h.signIn(await h.seed.superAdmin());

    expect(
      await h.as(admin).changeSetting({ key: "sms.enabled", value: true })
    ).toEqual({ ok: true, changed: true });
    await welcome(h, account.id);

    expect(h.sms.sent).toEqual([
      expect.objectContaining({ to: PHONE, dltTemplateId: DLT_ID }),
    ]);
  });
});

describe("an SMS template without a DLT id", () => {
  it("is held back as unregistered, and email covers for it", async () => {
    const h = await createHarness();
    await h.settings.set("sms.enabled", true);
    await welcomeRoute(h, { channels: ["sms"], requiredByLaw: true });
    const { account } = await memberWithPhone(h);

    await welcome(h, account.id);

    expect(h.sms.sent).toEqual([]);
    expect(welcomeEmailsTo(h, account.email)).toHaveLength(1);
    expect(await deliveries(h, account.id)).toContainEqual({
      channel: "sms",
      status: "suppressed",
      reason: "sms_unregistered",
    });
  });
});

describe("a user who withdrew consent to messages", () => {
  it("gets an ordinary message only in the inbox, and the withdrawal receipt by email", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());
    const document = await h.as(admin).publishConsentDocument({
      purpose: "messages",
      title: "News and updates",
      source: [
        "- We email you news about competitions.",
        "",
        "## What you agree to {#what-you-agree-to}",
        "",
        "News and updates by email.",
      ].join("\n"),
    });
    if (!document.ok) throw new Error("Could not publish");
    const { account, actor } = await memberWithPhone(h);
    await h
      .as(actor)
      .giveConsent({ purpose: "messages", documentId: document.id });
    await h.as(actor).withdrawConsent({ purpose: "messages" });
    await h.drain();

    const receipts = h.email.sent.filter(
      (message) => message.subject === "You withdrew your consent to messages"
    );
    expect(receipts).toEqual([expect.objectContaining({ to: account.email })]);

    await welcome(h, account.id);
    expect(welcomeEmailsTo(h, account.email)).toEqual([]);
    expect(await deliveries(h, account.id)).toContainEqual({
      channel: "email",
      status: "suppressed",
      reason: "consent_withdrawn",
    });
    expect(await inboxCount(h, account.id)).toBe(2);
  });
});
