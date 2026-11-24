import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import {
  auditLog,
  capturedMessage,
  contactMessage,
  setting,
} from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import { captureEmailSender } from "@/server/ports/email-capture";
import { captureSmsSender } from "@/server/ports/sms-capture";
import type { E164Phone } from "@/lib/phone";
import { createHarness, type Harness } from "@/test/harness";
import { solvedHumanCheck } from "@/test/human-check";

const WORKER: Actor = { kind: "system", process: "worker" };

async function captureOne(h: Harness) {
  await h.db.insert(capturedMessage).values({
    id: uuidv7(h.clock.now()),
    channel: "email",
    toAddress: "someone@example.test",
    subject: "Your sign-in code",
    bodyText: "Your code is 123456",
    createdAt: h.clock.now(),
  });
}

async function capturedCount(h: Harness) {
  return (await h.db.select().from(capturedMessage)).length;
}

describe("a retention period changed in settings", () => {
  it.each(["email", "sms"] as const)(
    "uses the configured period and legal holds for %s captures after later sends",
    async (channel) => {
      const h = await createHarness();
      await h.settings.set("retention.enforce", true);
      const admin = await h.seed.superAdmin();
      const staff = h.as(await h.signIn(admin));
      const phone = "+919876543210" as E164Phone;
      const recipient = await h.seed.member({ phone });
      const address = channel === "email" ? recipient.email : phone;
      expect(
        await staff.changeSetting({
          key: "retention.capturedMessagesDays",
          value: 60,
        })
      ).toEqual({ ok: true, changed: true });
      const email = captureEmailSender(h.deps);
      const sms = captureSmsSender(h.deps);
      const capture = (text: string) =>
        channel === "email"
          ? email.send({ to: address, subject: "Fixture capture", text })
          : sms.send({
              to: phone,
              template: "sign-in-code",
              vars: { code: "123456", minutes: "10" },
              text,
            });
      const rows = () =>
        h.db
          .select({ body: capturedMessage.bodyText })
          .from(capturedMessage)
          .where(eq(capturedMessage.toAddress, address))
          .orderBy(capturedMessage.createdAt);

      await capture("First message");
      h.clock.advance({ days: 8 });
      await capture("Later message");
      expect(await rows()).toEqual([
        { body: "First message" },
        { body: "Later message" },
      ]);

      h.clock.advance({ days: 52 });
      const freshStaff = h.as(await h.signIn(admin));
      const hold = await freshStaff.placeLegalHold({
        subjectType: "user",
        subjectId: recipient.id,
        reason: "Pending inquiry",
      });
      if (!hold.ok) throw new Error(hold.error);
      const worker = h.as(WORKER);
      expect(
        (await worker.runRetentionSweep()).policies.capturedMessages
      ).toMatchObject({ held: 1, deleted: 0 });
      expect(await rows()).toEqual([
        { body: "First message" },
        { body: "Later message" },
      ]);
      expect(
        await freshStaff.releaseLegalHold({ holdId: hold.holdId })
      ).toEqual({ ok: true });
      expect(
        (await worker.runRetentionSweep()).policies.capturedMessages
      ).toMatchObject({ held: 0, deleted: 1 });
      expect(await rows()).toEqual([{ body: "Later message" }]);
    }
  );

  it("uses the audited contact retention period at the calendar anniversary of a leap-day closure", async () => {
    const h = await createHarness({ now: "2024-02-29T04:00:00Z" });
    await h.settings.set("retention.enforce", true);
    const admin = await h.seed.superAdmin();
    const visitor = h.visitor();
    const sent = await h.as(visitor).submitContactMessage({
      topic: "GENERAL",
      name: "Asha Rao",
      email: "asha@example.test",
      subject: "A question",
      message: "Words the sender wrote.",
      humanCheck: await solvedHumanCheck(h, visitor),
    });
    if (!sent.ok) throw new Error(sent.error);
    const [message] = await h.db
      .select({ id: contactMessage.id })
      .from(contactMessage);
    h.clock.set("2024-02-29T04:01:00Z");
    expect(
      await h.as(await h.signIn(admin)).changeContactMessageStatus({
        messageId: message!.id,
        status: "closed",
        closeReason: "resolved",
      })
    ).toEqual({ ok: true, changed: true });

    const worker = h.as(WORKER);
    h.clock.set("2025-02-28T04:00:59.999Z");
    const unchanged = await worker.runRetentionSweep();
    expect(unchanged.policies.contactMessages).toMatchObject({ deleted: 0 });

    const staff = h.as(await h.signIn(admin));
    expect(
      await staff.changeSetting({
        key: "retention.contactMessagesMonths",
        value: 12,
      })
    ).toEqual({ ok: true, changed: true });
    const before = await worker.runRetentionSweep();
    expect(before.policies.contactMessages).toMatchObject({ deleted: 0 });
    h.clock.advance({ milliseconds: 1 });
    const atAnniversary = await worker.runRetentionSweep();
    expect(atAnniversary.policies.contactMessages).toMatchObject({
      deleted: 1,
    });
    expect(await h.db.select().from(contactMessage)).toEqual([]);

    const changes = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "setting.changed"));
    expect(changes).toMatchObject([
      {
        entityId: "retention.contactMessagesMonths",
        actorRole: "super_admin",
        after: { value: 12 },
      },
    ]);
  });

  it("applies to the next run without a deploy, and the change is audited", async () => {
    const h = await createHarness();
    await h.settings.set("retention.enforce", true);
    await captureOne(h);
    h.clock.advance({ days: 31 });
    const admin = await h.signIn(await h.seed.superAdmin());

    expect(
      await h.as(admin).changeSetting({
        key: "retention.capturedMessagesDays",
        value: 60,
      })
    ).toEqual({ ok: true, changed: true });
    await h.as(WORKER).runRetentionSweep();
    expect(await capturedCount(h)).toBe(1);

    h.clock.advance({ days: 29 });
    await h.as(WORKER).runRetentionSweep();
    expect(await capturedCount(h)).toBe(0);
    const [change] = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "setting.changed"));
    expect(change).toMatchObject({
      entityType: "setting",
      entityId: "retention.capturedMessagesDays",
      actorRole: "super_admin",
    });
  });

  it("needs a fresh second factor: without one nothing is stored", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());
    h.clock.advance({ minutes: 11 });

    await expect(
      h.as(admin).changeSetting({
        key: "retention.capturedMessagesDays",
        value: 60,
      })
    ).rejects.toMatchObject({ code: "step_up_required" });

    expect(await h.db.select().from(setting)).toEqual([]);
    expect(
      await h.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "setting.changed"))
    ).toEqual([]);
  });

  it("turns enforcement on only through a super admin's change", async () => {
    const h = await createHarness();
    await captureOne(h);
    h.clock.advance({ days: 31 });
    const admin = await h.signIn(await h.seed.superAdmin());

    await h.as(WORKER).runRetentionSweep();
    expect(await capturedCount(h)).toBe(1);
    await h.as(admin).changeSetting({ key: "retention.enforce", value: true });
    await h.as(WORKER).runRetentionSweep();
    expect(await capturedCount(h)).toBe(0);
  });
});
