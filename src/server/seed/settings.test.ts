import { asc } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { setting } from "@/server/db/schema";
import { readSetting } from "@/server/modules/settings";
import { createHarness } from "@/test/harness";

describe("the settings seed", () => {
  it("stores every setting once, however often it runs: the defaults, with SMS, the ledger export and volunteer applications on", async () => {
    const h = await createHarness();
    const rows = () => h.db.select().from(setting).orderBy(asc(setting.key));

    await h.seed.preview();
    const first = await rows();
    h.clock.advance({ days: 1 });
    await h.seed.preview();

    expect(await rows()).toEqual(first);
    expect(first.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: "adoption.minAdopterAgeYears", value: 18 },
      { key: "ambassadors.minAgeYears", value: 18 },
      { key: "ambassadors.minMembershipDays", value: 90 },
      {
        key: "ambassadors.qualifyingMilestones",
        value: "foa_finalist,volunteer",
      },
      { key: "artwork.dispatchDays", value: 14 },
      { key: "artwork.dispatchReminderLeadHours", value: 72 },
      {
        key: "artwork.packagingInstructions",
        value:
          "Protect the original work with suitable packaging and mark it with the Artwork ID.",
      },
      { key: "artwork.returnWindowDays", value: 30 },
      { key: "artwork.shippingPayer", value: false },
      { key: "auctions.antiSnipingWindowMinutes", value: 5 },
      { key: "auctions.enabled", value: true },
      { key: "auctions.maxPaymentOffers", value: 3 },
      { key: "auctions.minIncrementPaise", value: 5000 },
      { key: "auctions.paymentWindowHours", value: 72 },
      { key: "auth.emailSignIn", value: true },
      { key: "auth.staffSessionHours", value: 12 },
      { key: "breach.authorityEmail", value: "" },
      { key: "clubs.enabled", value: true },
      { key: "clubs.maxPerInstitution", value: 1 },
      { key: "donations.allowGuest", value: true },
      { key: "donations.enabled", value: true },
      { key: "donations.maxAmountRupees", value: 100_000 },
      { key: "donations.minAmountRupees", value: 100 },
      { key: "donations.pendingExpiryHours", value: 24 },
      { key: "donations.recurringEnabled", value: true },
      { key: "entries.resubmissionDays", value: 7 },
      { key: "gallery.reportsPerIpPerHour", value: 10 },
      { key: "gallery.withdrawalPurgeMinutes", value: 15 },
      // The accountant's export waits for HR-47 only in production (#109).
      { key: "ledger.accountantExport", value: true },
      { key: "ledger.approvalExpiryDays", value: 7 },
      { key: "ledger.manualEntryApprovalThresholdRupees", value: 50_000 },

      { key: "org.fcraEnabled", value: false },
      { key: "org.foaFacilityAddress", value: "" },
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
      { key: "reminders.eventStartsFirstHours", value: 24 },
      { key: "reminders.eventStartsSecondHours", value: 2 },
      { key: "reminders.schoolRoundShortlistDueFirstHours", value: 72 },
      { key: "reminders.schoolRoundShortlistDueSecondHours", value: 24 },
      { key: "retention.adoptionApplicationsDays", value: 730 },
      { key: "retention.ambassadorApplicationsDays", value: 365 },
      { key: "retention.capturedMessagesDays", value: 30 },
      { key: "retention.clubApplicationsDays", value: 730 },
      { key: "retention.clubMembershipsDays", value: 730 },
      { key: "retention.communityMembersDays", value: 365 },
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
      { key: "retention.surveyResponsesDays", value: 365 },
      { key: "retention.volunteerApplicationsDays", value: 365 },
      { key: "safeguarding.reportsPerIpPerHour", value: 10 },
      { key: "sms.enabled", value: true },
      { key: "sms.maxPerDay", value: 1000 },
      { key: "sms.maxPerHour", value: 200 },
      { key: "surveys.enabled", value: true },
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
