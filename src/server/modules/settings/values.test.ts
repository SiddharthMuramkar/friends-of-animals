import { describe, expect, it } from "vitest";

import {
  decideSettingChange,
  parseSettingValue,
  resolveAllSettings,
  resolveSetting,
} from "./values";

describe("resolveSetting", () => {
  it("returns the documented default when nothing is stored", () => {
    expect(resolveSetting("sms.enabled", undefined)).toEqual({
      key: "sms.enabled",
      value: false,
      defaultValue: false,
      source: "default",
      storedInvalid: false,
    });
  });

  it("returns the stored value when one is stored", () => {
    expect(resolveSetting("auth.staffSessionHours", { value: 8 })).toEqual({
      key: "auth.staffSessionHours",
      value: 8,
      defaultValue: 12,
      source: "stored",
      storedInvalid: false,
    });
  });

  it("falls back to the default when the stored value no longer fits", () => {
    expect(resolveSetting("auth.staffSessionHours", { value: 48 })).toEqual({
      key: "auth.staffSessionHours",
      value: 12,
      defaultValue: 12,
      source: "default",
      storedInvalid: true,
    });
  });
});

describe("parseSettingValue", () => {
  it("accepts a value that passes the setting's schema", () => {
    expect(parseSettingValue("sms.enabled", true)).toEqual({
      ok: true,
      value: true,
    });
    expect(parseSettingValue("auth.staffSessionHours", 24)).toEqual({
      ok: true,
      value: 24,
    });
  });

  it("trims a text setting, and takes empty as not set yet", () => {
    expect(parseSettingValue("org.pan", " AAAAA0000A ")).toEqual({
      ok: true,
      value: "AAAAA0000A",
    });
    expect(parseSettingValue("org.legalName", "")).toEqual({
      ok: true,
      value: "",
    });
  });

  it.each([
    ["sms.enabled", "yes", { reason: "wrong_type" }],
    ["sms.enabled", null, { reason: "wrong_type" }],
    ["auth.staffSessionHours", "12", { reason: "wrong_type" }],
    ["auth.staffSessionHours", 1.5, { reason: "wrong_type" }],
    ["auth.staffSessionHours", 0, { reason: "too_small", min: 1 }],
    ["auth.staffSessionHours", 25, { reason: "too_big", max: 24 }],
    ["org.pan", "AAAAA0000AB", { reason: "too_long", maxLength: 10 }],
    ["org.legalName", 42, { reason: "wrong_type" }],
  ] as const)("refuses %s = %j with %j", (key, raw, problem) => {
    expect(parseSettingValue(key, raw)).toEqual({
      ok: false,
      error: "invalid_value",
      problem,
    });
  });
});

describe("decideSettingChange", () => {
  it("stores a new value and records the value before and after", () => {
    const current = resolveSetting("org.has80G", undefined);

    expect(decideSettingChange(current, true)).toEqual({
      ok: true,
      changed: true,
      value: true,
      audit: {
        before: { value: false, source: "default" },
        after: { value: true },
      },
    });
  });

  it("is not a change when the value already applies", () => {
    expect(
      decideSettingChange(resolveSetting("sms.enabled", undefined), false)
    ).toEqual({ ok: true, changed: false });
    expect(
      decideSettingChange(
        resolveSetting("auth.staffSessionHours", { value: 8 }),
        8
      )
    ).toEqual({ ok: true, changed: false });
  });

  it("replaces a stored value that no longer fits, even with the default", () => {
    const current = resolveSetting("auth.staffSessionHours", { value: 48 });

    expect(decideSettingChange(current, 12)).toEqual({
      ok: true,
      changed: true,
      value: 12,
      audit: {
        before: { value: 12, source: "default" },
        after: { value: 12 },
      },
    });
  });

  it("refuses an invalid value", () => {
    const current = resolveSetting("auth.staffSessionHours", undefined);

    expect(decideSettingChange(current, 0)).toEqual({
      ok: false,
      error: "invalid_value",
      problem: { reason: "too_small", min: 1 },
    });
  });
});

describe("resolveAllSettings", () => {
  it("lists every setting in catalogue order, ignoring unknown rows", () => {
    const resolved = resolveAllSettings([
      { key: "org.has80G", value: true },
      { key: "retired.setting", value: "anything" },
    ]);

    expect(
      resolved.map(({ key, value, source }) => [key, value, source])
    ).toEqual([
      ["auth.staffSessionHours", 12, "default"],
      ["auth.emailSignIn", true, "default"],
      ["sms.enabled", false, "default"],
      ["sms.maxPerHour", 200, "default"],
      ["sms.maxPerDay", 1000, "default"],
      ["org.has80G", true, "stored"],
      ["org.fcraEnabled", false, "default"],
      ["org.legalName", "", "default"],
      ["org.registrationType", "", "default"],
      ["org.registrationNumber", "", "default"],
      ["org.pan", "", "default"],
      ["donations.enabled", false, "default"],
      ["donations.recurringEnabled", false, "default"],
      ["donations.allowGuest", true, "default"],
      ["donations.minAmountRupees", 100, "default"],
      ["donations.maxAmountRupees", 100_000, "default"],
      ["donations.pendingExpiryHours", 24, "default"],
      ["safeguarding.reportsPerIpPerHour", 10, "default"],
      ["breach.authorityEmail", "", "default"],
      ["ledger.manualEntryApprovalThresholdRupees", 50_000, "default"],
      ["ledger.approvalExpiryDays", 7, "default"],
      ["ledger.accountantExport", false, "default"],
      ["privacy.requestDueDays", 30, "default"],
      ["privacy.erasureDueDays", 30, "default"],
      ["privacy.exportLinkHours", 72, "default"],
      ["privacy.erasureEnabled", false, "default"],
      ["privacy.erasureKeepsPayerAccount", true, "default"],
      ["volunteers.applicationsOpen", false, "default"],
      ["volunteers.minAgeYears", 14, "default"],
      ["volunteers.guardianApprovalBelowAgeYears", 18, "default"],
      ["adoption.minAdopterAgeYears", 18, "default"],
      ["reminders.entrySubmissionDueFirstHours", 72, "default"],
      ["reminders.entrySubmissionDueSecondHours", 24, "default"],
      ["reminders.schoolRoundShortlistDueFirstHours", 72, "default"],
      ["reminders.schoolRoundShortlistDueSecondHours", 24, "default"],
      ["artwork.dispatchDays", 14, "default"],
      ["auctions.enabled", false, "default"],
      ["auctions.minIncrementPaise", 5000, "default"],
      ["auctions.antiSnipingWindowMinutes", 5, "default"],
      ["auctions.paymentWindowHours", 72, "default"],
      ["auctions.maxPaymentOffers", 3, "default"],
      ["artwork.returnWindowDays", 30, "default"],
      ["artwork.dispatchReminderLeadHours", 72, "default"],
      [
        "artwork.packagingInstructions",
        "Protect the original work with suitable packaging and mark it with the Artwork ID.",
        "default",
      ],
      ["artwork.shippingPayer", false, "default"],
      ["org.foaFacilityAddress", "", "default"],
      ["entries.resubmissionDays", 7, "default"],
      ["retention.enforce", false, "default"],
      ["retention.expiredVerificationsDays", 1, "default"],
      ["retention.expiredSessionsDays", 30, "default"],
      ["retention.capturedMessagesDays", 30, "default"],
      ["retention.messageDeliveriesDays", 365, "default"],
      ["retention.readInboxItemsDays", 365, "default"],
      ["retention.quarantinedFilesDays", 30, "default"],
      ["retention.dispatchedOutboxDays", 30, "default"],
      ["retention.coordinatorInvitationLinksDays", 1, "default"],
      ["retention.guardianInvitationLinksDays", 1, "default"],
      ["retention.coordinatorInvitationsDays", 90, "default"],
      ["retention.guardianInvitationsDays", 30, "default"],
      ["retention.contactMessagesMonths", 24, "default"],
      ["retention.volunteerApplicationsDays", 365, "default"],
      ["retention.communityMembersDays", 365, "default"],
      ["retention.adoptionApplicationsDays", 730, "default"],
      ["retention.releasedLegalHoldsDays", 365, "default"],
      ["retention.financialRecordsDays", 2922, "default"],
      ["retention.privacyRequestsDays", 1095, "default"],
    ]);
  });
});
