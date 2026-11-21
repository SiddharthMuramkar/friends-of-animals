// Seam 1 for message templates (#69): staff edit the wording of email, SMS
// and in-app messages without a deploy. PGlite with the real migrations,
// which hold the default templates.

import { and, count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { auditLog, messageTemplate } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

const WELCOME = "identity.welcome";

async function staff(
  h: Harness,
  role: "content_manager" | "staff_admin" | "super_admin"
): Promise<Actor> {
  const account = await h.seed.member();
  await h.seed.grant(account, { role, scope: { type: "global" } });
  return h.signIn(account);
}

async function templateRow(
  h: Harness,
  channel: "email" | "sms" | "in_app",
  key = WELCOME
) {
  const [row] = await h.db
    .select()
    .from(messageTemplate)
    .where(
      and(eq(messageTemplate.key, key), eq(messageTemplate.channel, channel))
    );
  return row;
}

async function auditCount(h: Harness) {
  const [row] = await h.db.select({ n: count() }).from(auditLog);
  return row?.n;
}

describe("listMessageTemplates", () => {
  it("shows a content manager every template key with its channels and the events that send it", async () => {
    const h = await createHarness();
    const manager = await staff(h, "content_manager");

    const templates = await h.as(manager).listMessageTemplates();

    expect(templates).toContainEqual({
      key: WELCOME,
      events: ["identity.user_signed_up"],
      channels: [
        expect.objectContaining({ channel: "email", version: 1 }),
        expect.objectContaining({
          channel: "sms",
          version: 1,
          dltTemplateId: null,
        }),
        expect.objectContaining({ channel: "in_app", version: 1 }),
      ],
    });
  });
});

describe("getMessageTemplate", () => {
  it("returns each channel's wording, its variables and its version", async () => {
    const h = await createHarness();
    const manager = await staff(h, "content_manager");

    const result = await h.as(manager).getMessageTemplate({ key: WELCOME });

    expect(result).toMatchObject({
      ok: true,
      template: {
        key: WELCOME,
        channels: [
          {
            channel: "email",
            subject: "Welcome to Friends of Animals",
            body: expect.stringContaining("Hello {{recipient.name}},"),
            variables: ["recipient.name"],
            dltTemplateId: null,
            version: 1,
          },
          { channel: "sms", subject: null, version: 1 },
          { channel: "in_app", version: 1 },
        ],
      },
    });
  });

  it("answers not found for a key that has no template", async () => {
    const h = await createHarness();
    const manager = await staff(h, "content_manager");

    expect(
      await h.as(manager).getMessageTemplate({ key: "no.such_template" })
    ).toEqual({ ok: false, error: "not_found" });
  });
});

describe("updateMessageTemplate", () => {
  it("saves the new wording as the next version, with one audit entry holding before and after", async () => {
    const h = await createHarness();
    const manager = await staff(h, "content_manager");
    const before = await templateRow(h, "email");

    const result = await h.as(manager).updateMessageTemplate({
      key: WELCOME,
      channel: "email",
      subject: "Namaste from Friends of Animals",
      body: "Dear {{recipient.name}},\n\nWelcome aboard.",
    });

    expect(result).toMatchObject({
      ok: true,
      template: {
        channel: "email",
        subject: "Namaste from Friends of Animals",
        body: "Dear {{recipient.name}},\n\nWelcome aboard.",
        version: 2,
      },
    });
    const after = await templateRow(h, "email");
    expect(after).toMatchObject({
      version: 2,
      subject: "Namaste from Friends of Animals",
    });
    const entries = await h.db.select().from(auditLog);
    expect(entries).toEqual([
      expect.objectContaining({
        action: "message_template.updated",
        entityType: "message_template",
        entityId: before!.id,
        actorRole: "content_manager",
        before: {
          key: WELCOME,
          channel: "email",
          version: 1,
          subject: before!.subject,
          body: before!.body,
          dltTemplateId: null,
        },
        after: {
          key: WELCOME,
          channel: "email",
          version: 2,
          subject: "Namaste from Friends of Animals",
          body: "Dear {{recipient.name}},\n\nWelcome aboard.",
          dltTemplateId: null,
        },
      }),
    ]);
  });

  it("refuses an unknown placeholder as invalid_template and writes nothing", async () => {
    const h = await createHarness();
    const manager = await staff(h, "content_manager");
    const before = await templateRow(h, "email");

    const result = await h.as(manager).updateMessageTemplate({
      key: WELCOME,
      channel: "email",
      subject: "Welcome",
      body: "Hello {{recipient.email}}",
    });

    expect(result).toEqual({
      ok: false,
      error: "invalid_template",
      problems: [
        { field: "body", code: "unknown_variable", name: "recipient.email" },
      ],
    });
    expect(await templateRow(h, "email")).toEqual(before);
    expect(await auditCount(h)).toBe(0);
  });

  it("clears the DLT id when the SMS wording changes, until someone sets one again", async () => {
    const h = await createHarness();
    const manager = await staff(h, "content_manager");
    const sms = await templateRow(h, "sms");

    const registered = await h.as(manager).updateMessageTemplate({
      key: WELCOME,
      channel: "sms",
      body: sms!.body,
      dltTemplateId: "1107170000000000001",
    });
    expect(registered).toMatchObject({
      ok: true,
      template: { dltTemplateId: "1107170000000000001", version: 2 },
    });

    const reworded = await h.as(manager).updateMessageTemplate({
      key: WELCOME,
      channel: "sms",
      body: "Welcome to FOA, {{recipient.name}}.",
    });
    expect(reworded).toMatchObject({
      ok: true,
      template: { dltTemplateId: null, version: 3 },
    });
    expect(await templateRow(h, "sms")).toMatchObject({
      dltTemplateId: null,
      version: 3,
    });
  });

  it("answers stale when the template changed since the editor loaded it", async () => {
    const h = await createHarness();
    const manager = await staff(h, "content_manager");
    await h.as(manager).updateMessageTemplate({
      key: WELCOME,
      channel: "in_app",
      subject: "Welcome",
      body: "Hello {{recipient.name}}.",
      version: 1,
    });

    const result = await h.as(manager).updateMessageTemplate({
      key: WELCOME,
      channel: "in_app",
      subject: "Hi",
      body: "Hi {{recipient.name}}.",
      version: 1,
    });

    expect(result).toEqual({ ok: false, error: "stale" });
    expect(await templateRow(h, "in_app")).toMatchObject({
      subject: "Welcome",
      version: 2,
    });
  });
});

describe("who may use the template use cases", () => {
  it("lets a super admin edit a template", async () => {
    const h = await createHarness();
    const admin = await staff(h, "super_admin");

    const result = await h.as(admin).updateMessageTemplate({
      key: WELCOME,
      channel: "in_app",
      subject: "Welcome",
      body: "Hello {{recipient.name}}.",
    });

    expect(result).toMatchObject({ ok: true, template: { version: 2 } });
  });

  it("refuses a staff admin, a member and a visitor, and writes nothing", async () => {
    const h = await createHarness();
    const before = await templateRow(h, "email");
    const refused: [string, Actor][] = [
      ["a staff admin", await staff(h, "staff_admin")],
      ["a member", await h.signIn(await h.seed.member())],
      ["a visitor", h.visitor()],
    ];

    for (const [who, actor] of refused) {
      const app = h.as(actor);
      for (const call of [
        () => app.listMessageTemplates(),
        () => app.getMessageTemplate({ key: WELCOME }),
        () =>
          app.updateMessageTemplate({
            key: WELCOME,
            channel: "email",
            subject: "Hacked",
            body: "Hacked",
          }),
      ]) {
        await expect(call(), who).rejects.toMatchObject({
          name: "DomainError",
          code: "forbidden",
        });
      }
    }
    expect(await templateRow(h, "email")).toEqual(before);
    expect(await auditCount(h)).toBe(0);
  });
});
