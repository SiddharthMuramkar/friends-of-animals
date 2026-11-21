import { describe, expect, it } from "vitest";

import { DECISION_REASON_MAX_LENGTH } from "./application-status";
import {
  applicationIdInput,
  applyForAmbassadorInput,
  declineAmbassadorInput,
  MOTIVATION_MAX_LENGTH,
} from "./inputs";

const ID = "01938a00-0000-7000-8000-000000000101";

/** The issue codes zod reports, as the form maps them to messages. */
const issues = (result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}) =>
  result.success ? [] : result.error!.issues.map((issue) => issue.message);

describe("applyForAmbassadorInput", () => {
  it("keeps the motivation trimmed, with its line breaks", () => {
    expect(
      applyForAmbassadorInput.parse({
        motivation: "  I run a feeding drive.\n\nI'd like to do more.  ",
      })
    ).toEqual({ motivation: "I run a feeding drive.\n\nI'd like to do more." });
  });

  it("turns the CRLF line breaks a textarea submits into LF", () => {
    expect(
      applyForAmbassadorInput.parse({ motivation: "One.\r\nTwo.\rThree." })
    ).toEqual({ motivation: "One.\nTwo.\nThree." });
  });

  it("needs a motivation", () => {
    expect(
      issues(applyForAmbassadorInput.safeParse({ motivation: "" }))
    ).toEqual(["required"]);
    expect(
      issues(applyForAmbassadorInput.safeParse({ motivation: " \r\n " }))
    ).toEqual(["required"]);
  });

  it(`allows up to ${MOTIVATION_MAX_LENGTH} characters, an emoji counting once`, () => {
    const longest = "🐾".repeat(MOTIVATION_MAX_LENGTH);
    expect(
      applyForAmbassadorInput.safeParse({ motivation: longest }).success
    ).toBe(true);
    expect(
      issues(applyForAmbassadorInput.safeParse({ motivation: `${longest}a` }))
    ).toEqual(["too_long"]);
  });

  it("refuses control characters other than line breaks", () => {
    expect(
      issues(applyForAmbassadorInput.safeParse({ motivation: "Hi\u0000there" }))
    ).toEqual(["invalid_characters"]);
    expect(
      issues(applyForAmbassadorInput.safeParse({ motivation: "Hi\tthere" }))
    ).toEqual(["invalid_characters"]);
  });

  it("accepts nothing else", () => {
    expect(
      applyForAmbassadorInput.safeParse({ motivation: "Yes", userId: ID })
        .success
    ).toBe(false);
    expect(applyForAmbassadorInput.safeParse({}).success).toBe(false);
  });
});

describe("declineAmbassadorInput", () => {
  it("takes an application id and a trimmed reason", () => {
    expect(
      declineAmbassadorInput.parse({
        applicationId: ID,
        reason: " Volunteer at one event first.\r\n",
      })
    ).toEqual({ applicationId: ID, reason: "Volunteer at one event first." });
  });

  it("needs a reason", () => {
    expect(
      issues(
        declineAmbassadorInput.safeParse({ applicationId: ID, reason: "  " })
      )
    ).toEqual(["required"]);
  });

  it(`allows up to ${DECISION_REASON_MAX_LENGTH} characters`, () => {
    const longest = "a".repeat(DECISION_REASON_MAX_LENGTH);
    expect(
      declineAmbassadorInput.safeParse({ applicationId: ID, reason: longest })
        .success
    ).toBe(true);
    expect(
      issues(
        declineAmbassadorInput.safeParse({
          applicationId: ID,
          reason: `${longest}a`,
        })
      )
    ).toEqual(["too_long"]);
  });

  it("refuses an id that isn't a UUID", () => {
    expect(
      declineAmbassadorInput.safeParse({ applicationId: "42", reason: "No" })
        .success
    ).toBe(false);
  });
});

describe("applicationIdInput", () => {
  it("takes one application id, for approve and withdraw", () => {
    expect(applicationIdInput.parse({ applicationId: ID })).toEqual({
      applicationId: ID,
    });
    expect(
      applicationIdInput.safeParse({ applicationId: "nope" }).success
    ).toBe(false);
    expect(
      applicationIdInput.safeParse({ applicationId: ID, reason: "x" }).success
    ).toBe(false);
  });
});
