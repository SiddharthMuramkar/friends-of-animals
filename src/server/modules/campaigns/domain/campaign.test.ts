import { describe, expect, it } from "vitest";

import {
  CAMPAIGN_LIMITS,
  CAMPAIGN_STATUSES,
  campaignContentSchema,
  canMoveCampaign,
} from "./campaign";

describe("canMoveCampaign", () => {
  it.each([
    ["draft", "sending", true],
    ["sending", "sent", true],
    ["draft", "sent", false],
    ["draft", "draft", false],
    ["sending", "draft", false],
    ["sent", "draft", false],
    ["sent", "sending", false],
    ["sent", "sent", false],
  ] as const)("%s → %s is %s", (from, to, allowed) => {
    expect(canMoveCampaign(from, to)).toBe(allowed);
  });

  it("knows every status", () => {
    expect(CAMPAIGN_STATUSES).toEqual(["draft", "sending", "sent"]);
  });
});

describe("campaignContentSchema", () => {
  it("trims the subject and the body, and keeps the body's line breaks", () => {
    expect(
      campaignContentSchema.parse({
        subject: "  Adopt, don't shop  ",
        body: "\r\nCome to the camp.\r\n\r\nBring a friend.  ",
      })
    ).toEqual({
      subject: "Adopt, don't shop",
      body: "Come to the camp.\n\nBring a friend.",
    });
  });

  it.each([
    ["an empty subject", { subject: "  ", body: "Hello" }],
    ["an empty body", { subject: "Hello", body: " \n " }],
    ["a subject over two lines", { subject: "Hello\nBcc: x", body: "Hi" }],
    [
      "a subject that is too long",
      { subject: "x".repeat(CAMPAIGN_LIMITS.subject + 1), body: "Hi" },
    ],
    [
      "a body that is too long",
      { subject: "Hi", body: "x".repeat(CAMPAIGN_LIMITS.body + 1) },
    ],
  ])("refuses %s", (_, input) => {
    expect(campaignContentSchema.safeParse(input).success).toBe(false);
  });
});
