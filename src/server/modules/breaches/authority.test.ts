import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { outbox } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import {
  breachAudit,
  noticeHarness,
  recordedBreach,
  setBreachNoticeRoute,
  staffActor,
  storedBreach,
  timelineKinds,
} from "./testing";

// #116: the authority hears of a breach by email to the address in the
// setting breach.authorityEmail, or, while it is unset, staff file the
// notice by hand and record the reference they were given (HR-49).

const AUTHORITY = "breaches@authority.example.test";
const AUTHORITY_NOTICE = "breach.authority_notice";
const REPORT_SUBJECT =
  "Personal data breach report from Friends of Animals: Entry export emailed to the wrong school";

function reports(h: Harness) {
  return h.email.sent.filter((message) => message.to === AUTHORITY);
}

describe("notifyAuthority", () => {
  it("emails the configured address once, through the outbox", async () => {
    const h = await noticeHarness(AUTHORITY_NOTICE);
    await h.settings.set("breach.authorityEmail", AUTHORITY);
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);

    const result = await h.as(admin).notifyAuthority({ breachId });

    expect(result).toEqual({ ok: true, channel: "email" });
    expect(reports(h)).toEqual([]);
    expect(await h.as(admin).getBreach({ breachId })).toMatchObject({
      ok: true,
      breach: {
        status: "open",
        authority: {
          channel: "email",
          notifiedAt: null,
          emailQueuedAt: h.clock.now(),
          emailSentAt: null,
        },
        canNotifyAuthority: false,
      },
    });
    expect(await h.as(admin).notifyAuthority({ breachId })).toEqual({
      ok: false,
      error: "authority_email_queued",
    });
    h.clock.advance({ minutes: 1 });
    await h.drain();

    expect(reports(h)).toEqual([
      expect.objectContaining({ subject: REPORT_SUBJECT }),
    ]);
    const text = reports(h)[0]?.text ?? "";
    expect(text).toContain("Severity: High");
    expect(text).toContain("People affected (estimate): 3");
    expect(text).toContain("Children affected: Yes");
    expect(text).not.toContain("three entrants");
    expect(await storedBreach(h, breachId)).toMatchObject({
      status: "notified",
      authorityNotifiedAt: h.clock.now(),
      authorityEmailQueuedAt: null,
      authorityEmailSentAt: h.clock.now(),
      authorityReference: null,
    });
    expect(await timelineKinds(h, breachId)).toEqual([
      "recorded",
      "authority_notified",
    ]);
    expect((await breachAudit(h, breachId)).at(-1)).toMatchObject({
      action: "breach.authority_notified",
      before: { status: "open", authorityNotifiedAt: null },
      after: {
        status: "notified",
        authorityNotifiedAt: h.clock.now().toISOString(),
      },
    });
  });

  it("says the authority was already told, and sends nothing more", async () => {
    const h = await noticeHarness(AUTHORITY_NOTICE);
    await h.settings.set("breach.authorityEmail", AUTHORITY);
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);
    await h.as(admin).notifyAuthority({ breachId });
    await h.drain();
    const audit = await breachAudit(h, breachId);

    const again = await h.as(admin).notifyAuthority({ breachId });
    await h.drain();

    expect(again).toEqual({ ok: false, error: "already_notified" });
    expect(reports(h)).toHaveLength(1);
    expect(await breachAudit(h, breachId)).toEqual(audit);
  });

  it("records the reference of a notice filed by hand, encrypted, while no address is set", async () => {
    const h = await createHarness();
    const admin = await staffActor(h, "staff_admin");
    const breachId = await recordedBreach(h, admin);

    const result = await h
      .as(admin)
      .notifyAuthority({ breachId, manualReference: "DPB/2027/00042" });
    await h.drain();

    expect(result).toEqual({ ok: true, channel: "manual" });
    expect(h.email.sent.filter((m) => m.subject === REPORT_SUBJECT)).toEqual(
      []
    );
    const raw = await h.db.execute(
      sql`SELECT authority_reference_ciphertext FROM breach_record WHERE id = ${breachId}`
    );
    expect(JSON.stringify(raw)).not.toContain("DPB/2027/00042");
    const view = await h.as(admin).getBreach({ breachId });
    expect(view).toMatchObject({
      ok: true,
      breach: {
        status: "notified",
        authority: {
          channel: "manual",
          reference: "DPB/2027/00042",
          notifiedAt: h.clock.now(),
          emailConfigured: false,
        },
        canNotifyAuthority: false,
      },
    });
    expect(JSON.stringify(await breachAudit(h, breachId))).not.toContain(
      "DPB/2027"
    );
  });

  it("refuses with neither an address nor a reference, and writes nothing", async () => {
    const h = await createHarness();
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);

    const result = await h.as(admin).notifyAuthority({ breachId });

    expect(result).toEqual({ ok: false, error: "authority_unconfigured" });
    expect((await storedBreach(h, breachId)).status).toBe("open");
    expect(await timelineKinds(h, breachId)).toEqual(["recorded"]);
    expect(await breachAudit(h, breachId)).toHaveLength(1);
  });

  it("refuses an address that isn't an email address, and writes nothing", async () => {
    const h = await createHarness();
    await h.settings.set("breach.authorityEmail", "the data board");
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);

    const result = await h.as(admin).notifyAuthority({ breachId });

    expect(result).toEqual({ ok: false, error: "authority_email_invalid" });
    expect(await timelineKinds(h, breachId)).toEqual(["recorded"]);
  });

  it("tells no authority about a closed breach", async () => {
    const h = await createHarness();
    await h.settings.set("breach.authorityEmail", AUTHORITY);
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);
    await h.as(admin).containBreach({ breachId });
    await h.as(admin).closeBreach({ breachId, reason: "Nothing left FOA." });

    const result = await h.as(admin).notifyAuthority({ breachId });

    expect(result).toEqual({ ok: false, error: "breach_closed" });
  });

  it("holds the email while the address is emptied, and sends it once it is back", async () => {
    const h = await noticeHarness(AUTHORITY_NOTICE);
    await h.settings.set("breach.authorityEmail", AUTHORITY);
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);
    await h.as(admin).notifyAuthority({ breachId });
    await h.settings.set("breach.authorityEmail", "");

    await h.drain();
    expect(reports(h)).toEqual([]);

    await h.settings.set("breach.authorityEmail", AUTHORITY);
    h.clock.advance({ minutes: 5 });
    await h.drain();
    expect(reports(h)).toHaveLength(1);
  });

  it.each(["disabled route", "mail outage"])(
    "retries the original authority email after a %s exhausts delivery attempts",
    async (outage) => {
      const h = await createHarness();
      const admin = await staffActor(h, "super_admin");
      const staff = h.as(admin);
      const breachId = await recordedBreach(h, admin);
      const deliveries = () =>
        h.db
          .select({
            id: outbox.id,
            status: outbox.status,
            attempts: outbox.attempts,
          })
          .from(outbox)
          .where(
            and(
              eq(outbox.aggregateId, breachId),
              eq(outbox.eventType, AUTHORITY_NOTICE)
            )
          );

      await h.settings.set("breach.authorityEmail", AUTHORITY);
      if (outage === "mail outage") {
        await setBreachNoticeRoute(h, AUTHORITY_NOTICE, true);
        h.email.failNext(5);
      }
      await expect(staff.notifyAuthority({ breachId })).resolves.toEqual({
        ok: true,
        channel: "email",
      });
      const [original] = await deliveries();
      for (const seconds of [0, 30, 60, 120, 240]) {
        h.clock.advance({ seconds });
        await h.drain();
      }
      expect(await deliveries()).toEqual([
        { id: original!.id, status: "failed", attempts: 5 },
      ]);
      expect(reports(h)).toEqual([]);

      const failedAt = h.clock.now();
      if (outage === "disabled route") {
        await expect(staff.notifyAuthority({ breachId })).resolves.toEqual({
          ok: false,
          error: "authority_email_route_unavailable",
        });
        expect(await deliveries()).toEqual([
          { id: original!.id, status: "failed", attempts: 5 },
        ]);
      }
      await setBreachNoticeRoute(h, AUTHORITY_NOTICE, true);
      const view = await staff.getBreach({ breachId });
      const retry = await staff.notifyAuthority({ breachId });
      await expect(staff.notifyAuthority({ breachId })).resolves.toEqual({
        ok: false,
        error: "authority_email_queued",
      });
      await h.drain();

      expect.soft(view).toMatchObject({
        ok: true,
        breach: {
          authority: {
            emailFailedAt: failedAt,
            notifiedAt: null,
            emailSentAt: null,
          },
          canNotifyAuthority: true,
        },
      });
      expect.soft(retry).toEqual({ ok: true, channel: "email" });
      expect(await deliveries()).toEqual([
        { id: original!.id, status: "dispatched", attempts: 1 },
      ]);
      expect(await staff.notifyAuthority({ breachId })).toEqual({
        ok: false,
        error: "already_notified",
      });
      expect(reports(h)).toHaveLength(1);
      expect(await timelineKinds(h, breachId)).toEqual([
        "recorded",
        "authority_notified",
      ]);
      expect(
        (await breachAudit(h, breachId)).map(({ action }) => action)
      ).toEqual([
        "breach.recorded",
        "breach.authority_email_queued",
        "breach.authority_email_requeued",
        "breach.authority_notified",
      ]);
    }
  );

  it.each([
    ["cleared", ""],
    ["invalid", "the data board"],
  ])(
    "records a manual filing when the queued email address is %s",
    async (_, address) => {
      const h = await noticeHarness(AUTHORITY_NOTICE);
      const admin = await staffActor(h, "staff_admin");
      const staff = h.as(admin);
      const breachId = await recordedBreach(h, admin);
      const reference = "DPB/2027/00043";
      await h.settings.set("breach.authorityEmail", AUTHORITY);
      await expect(staff.notifyAuthority({ breachId })).resolves.toEqual({
        ok: true,
        channel: "email",
      });
      await h.settings.set("breach.authorityEmail", address);
      await h.drain();
      const beforeFiling = await staff.getBreach({ breachId });
      expect(
        h.email.sent.filter((message) => message.subject === REPORT_SUBJECT)
      ).toEqual([]);

      h.clock.advance({ minutes: 1 });
      await expect(
        staff.notifyAuthority({ breachId, manualReference: reference })
      ).resolves.toEqual({ ok: true, channel: "manual" });
      expect(beforeFiling).toMatchObject({
        ok: true,
        breach: {
          status: "open",
          authority: { channel: "email", notifiedAt: null, emailSentAt: null },
          canNotifyAuthority: true,
        },
      });
      expect(await staff.getBreach({ breachId })).toMatchObject({
        ok: true,
        breach: {
          status: "notified",
          authority: {
            channel: "manual",
            reference,
            notifiedAt: h.clock.now(),
            emailQueuedAt: null,
            emailSentAt: null,
          },
          canNotifyAuthority: false,
        },
      });
      expect(await timelineKinds(h, breachId)).toEqual([
        "recorded",
        "authority_notified",
      ]);
      const audit = await breachAudit(h, breachId);
      expect(
        audit.filter((row) => row.action === "breach.authority_notified")
      ).toHaveLength(1);
      expect(JSON.stringify(audit)).not.toContain(reference);

      await h.settings.set("breach.authorityEmail", AUTHORITY);
      h.clock.advance({ minutes: 5 });
      await h.drain();
      expect(
        h.email.sent.filter((message) => message.subject === REPORT_SUBJECT)
      ).toEqual([]);
      expect(await staff.notifyAuthority({ breachId })).toEqual({
        ok: false,
        error: "already_notified",
      });
      const deliveries = await h.db
        .select({ status: outbox.status })
        .from(outbox)
        .where(
          and(
            eq(outbox.aggregateId, breachId),
            eq(outbox.eventType, "breach.authority_notice")
          )
        );
      expect(deliveries).toEqual([{ status: "dispatched" }]);
    }
  );
});

describe("the breach transition table, through the use cases", () => {
  it("lets a notice go before containment, then stamps containment without moving", async () => {
    const h = await createHarness();
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);
    await h
      .as(admin)
      .notifyAuthority({ breachId, manualReference: "DPB/2027/7" });
    h.clock.advance({ hours: 1 });

    const contained = await h.as(admin).containBreach({ breachId });

    expect(contained).toEqual({ ok: true, status: "notified" });
    expect(await storedBreach(h, breachId)).toMatchObject({
      status: "notified",
      containedAt: h.clock.now(),
    });
  });

  it("closes a notified breach only once it is contained, writing nothing when refused", async () => {
    const h = await createHarness();
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);
    await h
      .as(admin)
      .notifyAuthority({ breachId, manualReference: "DPB/2027/8" });
    const audit = await breachAudit(h, breachId);

    expect(await h.as(admin).closeBreach({ breachId })).toEqual({
      ok: false,
      error: "not_contained",
    });
    expect(await breachAudit(h, breachId)).toEqual(audit);
    expect(await timelineKinds(h, breachId)).toEqual([
      "recorded",
      "authority_notified",
    ]);

    await h.as(admin).containBreach({ breachId });
    expect(await h.as(admin).closeBreach({ breachId })).toEqual({
      ok: true,
      status: "closed",
    });
  });

  it("keeps a breach notified as more people are told after the authority", async () => {
    const h = await createHarness();
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);
    await h.as(admin).containBreach({ breachId });
    await h
      .as(admin)
      .notifyAuthority({ breachId, manualReference: "DPB/2027/9" });
    const member = await h.seed.member();

    const result = await h.as(admin).notifyAffectedUsers({
      breachId,
      subjects: [{ type: "user", id: member.id }],
    });

    expect(result).toMatchObject({ ok: true, noticesQueued: 1 });
    expect(await storedBreach(h, breachId)).toMatchObject({
      status: "notified",
      principalsNotifiedAt: h.clock.now(),
    });
    expect(await timelineKinds(h, breachId)).toEqual([
      "recorded",
      "contained",
      "authority_notified",
      "principals_notified",
    ]);
  });
});
