import { describe, expect, expectTypeOf, it } from "vitest";

import type { AppDb } from "../../db/app-db";
import { isSettingKey, SETTING_KEYS, SETTINGS } from "./catalogue";
import { readSetting } from "./read";

describe("the settings catalogue", () => {
  it("holds the first settings with their documented defaults", () => {
    // #62 and HR-19: SMS off, 80G off, FCRA off, staff sessions 12 hours,
    // and #58's ceiling on sign-in texts: 200 an hour, 1,000 a day. #57:
    // email sign-in on (production also waits for SES, R-27). #116: 10
    // safeguarding reports an hour from one IP. #114: retention off until
    // a super admin turns it on, and each policy's period in days (the
    // financial records' is their 8-year floor). #84: submission reminders
    // 72 and 24 hours before the deadline (HR-37). #109: manual entries
    // over Rs 50,000 wait for a second approver, requests expire after 7
    // days, and the accountant's export stays off until HR-47.
    expect(
      Object.fromEntries(
        SETTING_KEYS.map((key) => [key, SETTINGS[key].default])
      )
    ).toEqual({
      "auth.staffSessionHours": 12,
      "auth.emailSignIn": true,
      "sms.enabled": false,
      "sms.maxPerHour": 200,
      "sms.maxPerDay": 1000,
      "org.has80G": false,
      "org.fcraEnabled": false,
      "org.legalName": "",
      "org.registrationType": "",
      "org.registrationNumber": "",
      "org.pan": "",
      // #106: donations off until HR-15 and HR-47; amounts and expiry
      // wait on HR-51.
      "donations.enabled": false,
      "donations.allowGuest": true,
      "donations.minAmountRupees": 100,
      "donations.maxAmountRupees": 100_000,
      "donations.pendingExpiryHours": 24,
      "safeguarding.reportsPerIpPerHour": 10,
      "breach.authorityEmail": "",
      "ledger.manualEntryApprovalThresholdRupees": 50_000,
      "ledger.approvalExpiryDays": 7,
      "ledger.accountantExport": false,
      "privacy.requestDueDays": 30,
      "privacy.erasureDueDays": 30,
      "privacy.exportLinkHours": 72,
      "privacy.erasureEnabled": false,
      "privacy.erasureKeepsPayerAccount": true,
      "volunteers.applicationsOpen": false,
      "volunteers.minAgeYears": 14,
      "volunteers.guardianApprovalBelowAgeYears": 18,
      "adoption.minAdopterAgeYears": 18,
      "reminders.entrySubmissionDueFirstHours": 72,
      "reminders.entrySubmissionDueSecondHours": 24,
      "reminders.schoolRoundShortlistDueFirstHours": 72,
      "reminders.schoolRoundShortlistDueSecondHours": 24,
      "entries.resubmissionDays": 7,
      "retention.enforce": false,
      "retention.expiredVerificationsDays": 1,
      "retention.expiredSessionsDays": 30,
      "retention.capturedMessagesDays": 30,
      "retention.messageDeliveriesDays": 365,
      "retention.readInboxItemsDays": 365,
      "retention.quarantinedFilesDays": 30,
      "retention.dispatchedOutboxDays": 30,
      "retention.coordinatorInvitationLinksDays": 1,
      "retention.guardianInvitationLinksDays": 1,
      "retention.coordinatorInvitationsDays": 90,
      "retention.guardianInvitationsDays": 30,
      "retention.contactMessagesMonths": 24,
      "retention.volunteerApplicationsDays": 365,
      "retention.adoptionApplicationsDays": 730,
      "retention.releasedLegalHoldsDays": 365,
      "retention.financialRecordsDays": 2922,
      "retention.privacyRequestsDays": 1095,
    });
  });

  it("names every key <group>.<name>, so it doubles as a message path", () => {
    for (const key of SETTING_KEYS) {
      expect(key).toMatch(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/);
    }
  });

  it("gives every setting a default that passes its own schema", () => {
    for (const key of SETTING_KEYS) {
      const { schema, default: fallback } = SETTINGS[key];
      expect(schema.safeParse(fallback).success, key).toBe(true);
    }
  });

  it("recognises only catalogue keys", () => {
    expect(isSettingKey("sms.enabled")).toBe(true);
    expect(isSettingKey("sms.disabled")).toBe(false);
    expect(isSettingKey("toString")).toBe(false);
    expect(isSettingKey("__proto__")).toBe(false);
  });

  it("types app code's reads: catalogue keys only, each with its own value type", () => {
    // pnpm typecheck is the assertion: nothing here reads a database.
    expectTypeOf(
      readSetting<"auth.staffSessionHours">
    ).returns.resolves.toEqualTypeOf<number>();
    expectTypeOf(
      readSetting<"sms.enabled">
    ).returns.resolves.toEqualTypeOf<boolean>();
    const readUnknown = (db: AppDb) =>
      // @ts-expect-error "org.unknown" isn't in the catalogue
      readSetting(db, "org.unknown");
    expectTypeOf(readUnknown).toBeFunction();
  });
});
