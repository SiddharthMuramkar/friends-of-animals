import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import { createHarness } from "@/test/harness";

import journal from "../../../../drizzle/meta/_journal.json";
import adminAnnouncements from "../../../../messages/en-IN/adminAnnouncements.json";

describe("announcement migrations", () => {
  it("adds the delivery enum before generated DDL and installs templates afterward", () => {
    const tags = journal.entries.map(({ tag }) => tag);
    const pre = tags.findIndex((tag) =>
      tag.endsWith("_84_pre_enum_message_delivery")
    );
    const ddl = tags.findIndex((tag) => tag.endsWith("_84_announcements"));
    const post = tags.findIndex((tag) =>
      tag.endsWith("_84_announcement_messages")
    );
    expect(pre).toBeGreaterThan(-1);
    expect(ddl).toBe(pre + 1);
    expect(post).toBe(ddl + 1);
    // 84b's reminder migrations follow later; none touches the enum.
    expect(
      tags.filter((tag) => /^\d+_84_(pre_enum|announcement)/.test(tag))
    ).toEqual([
      tags[pre],
      tags[ddl],
      tags[post],
    ]);
    const statements = (index: number) =>
      readFileSync(`drizzle/${tags[index]}.sql`, "utf8");
    expect(
      statements(pre)
        .replace(/^--[^\n]*\n/gm, "")
        .trim()
    ).toBe(
      `ALTER TYPE "public"."message_delivery_status" ADD VALUE IF NOT EXISTS 'sending';`
    );
    expect(statements(ddl)).not.toMatch(/ADD VALUE|'sending'/);
    expect(statements(post)).not.toMatch(/'sending'/);
  });

  it("installs a lookup index for external delivery claims by account", async () => {
    const h = await createHarness();
    const found = await h.db.execute(sql`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'message_delivery'
    `);
    expect(found.rows.map(({ indexdef }) => indexdef)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /CREATE INDEX .* USING btree \(event_id, template_key, channel, recipient_account_hash\)/
        ),
      ])
    );
  });

  it("installs editable email, inbox and SMS copy from the announcement locale", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());
    const template = await h
      .as(admin)
      .getMessageTemplate({ key: "announcements.announcement" });
    if (!template.ok) throw new Error("Announcement templates are missing");
    const t = createTranslator({
      locale: "en-IN",
      messages: adminAnnouncements,
      onError: (error) => {
        throw error;
      },
    });
    const values = {
      recipientName: "{{recipient.name}}",
      competitionName: "{{competition.name}}",
      subject: "{{announcement.subject}}",
      body: "{{announcement.body}}",
    };
    expect(template.template.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: "email",
          subject: t("adminAnnouncements.template.subject", values),
          body: t("adminAnnouncements.template.email", values),
          version: 1,
        }),
        expect.objectContaining({
          channel: "in_app",
          subject: t("adminAnnouncements.template.subject", values),
          body: t("adminAnnouncements.template.inApp", values),
          version: 1,
        }),
        expect.objectContaining({
          channel: "sms",
          subject: null,
          body: t("adminAnnouncements.template.sms", values),
          version: 1,
          dltTemplateId: null,
        }),
      ])
    );
  });
});
