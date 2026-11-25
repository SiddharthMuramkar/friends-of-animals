import { asc } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { setting } from "@/server/db/schema";
import { readSetting } from "@/server/modules/settings";
import { createHarness } from "@/test/harness";

describe("the settings seed", () => {
  it("stores every setting once, however often it runs: the defaults, with SMS and volunteer applications on", async () => {
    const h = await createHarness();
    const rows = () => h.db.select().from(setting).orderBy(asc(setting.key));

    await h.seed.preview();
    const first = await rows();
    h.clock.advance({ days: 1 });
    await h.seed.preview();

    expect(await rows()).toEqual(first);
    expect(first.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: "auth.emailSignIn", value: true },
      { key: "auth.staffSessionHours", value: 12 },
      { key: "breach.authorityEmail", value: "" },
      { key: "entries.resubmissionDays", value: 7 },
      { key: "org.fcraEnabled", value: false },
      { key: "org.has80G", value: false },
      // FOA's tax facts stay empty: previews show "To be confirmed" (#111).
      { key: "org.legalName", value: "" },
      { key: "org.pan", value: "" },
      { key: "org.registrationNumber", value: "" },
      { key: "org.registrationType", value: "" },
      { key: "privacy.erasureDueDays", value: 30 },
      { key: "privacy.erasureEnabled", value: true },
      { key: "privacy.erasureKeepsPayerAccount", value: true },
      { key: "privacy.exportLinkHours", value: 72 },
      { key: "privacy.requestDueDays", value: 30 },
      { key: "reminders.entrySubmissionDueFirstHours", value: 72 },
      { key: "reminders.entrySubmissionDueSecondHours", value: 24 },
      { key: "retention.capturedMessagesDays", value: 30 },
      { key: "retention.contactMessagesMonths", value: 24 },
      { key: "retention.coordinatorInvitationLinksDays", value: 1 },
      { key: "retention.coordinatorInvitationsDays", value: 90 },
      { key: "retention.dispatchedOutboxDays", value: 30 },
      { key: "retention.enforce", value: false },
      { key: "retention.expiredSessionsDays", value: 30 },
      { key: "retention.expiredVerificationsDays", value: 1 },
      { key: "retention.financialRecordsDays", value: 2922 },
      { key: "retention.guardianInvitationLinksDays", value: 1 },
      { key: "retention.guardianInvitationsDays", value: 30 },
      { key: "retention.messageDeliveriesDays", value: 365 },
      { key: "retention.privacyRequestsDays", value: 1095 },
      { key: "retention.quarantinedFilesDays", value: 30 },
      { key: "retention.readInboxItemsDays", value: 365 },
      { key: "retention.releasedLegalHoldsDays", value: 365 },
      { key: "retention.volunteerApplicationsDays", value: 365 },
      { key: "safeguarding.reportsPerIpPerHour", value: 10 },
      { key: "sms.enabled", value: true },
      { key: "sms.maxPerDay", value: 1000 },
      { key: "sms.maxPerHour", value: 200 },
      // Open where nothing is real (#123); production keeps the default.
      { key: "volunteers.applicationsOpen", value: true },
      { key: "volunteers.guardianApprovalBelowAgeYears", value: 18 },
      { key: "volunteers.minAgeYears", value: 14 },
    ]);
  });

  it("turns sign-in by text on where it seeds: local runs and previews capture texts", async () => {
    const h = await createHarness();
    const visitor = h.visitor();
    expect((await h.as(visitor).signInMethods()).phone).toBe(false);

    await h.seed.preview();

    expect((await h.as(visitor).signInMethods()).phone).toBe(true);
  });

  it("keeps a value someone changed on the preview", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const admin = await h.signIn(await h.seed.superAdmin());
    await h.as(admin).changeSetting({ key: "org.has80G", value: true });

    await h.seed.preview();

    expect(await readSetting(h.db, "org.has80G")).toBe(true);
  });
});
