import { describe, expect, it } from "vitest";

import { planDelivery, type DeliveryPlanInput } from "./delivery-plan";

/** A user who wants everything, reachable everywhere, with SMS live. */
const everythingOn: DeliveryPlanInput = {
  routeChannels: ["email", "sms", "in_app"],
  requiredByLaw: false,
  preferences: { email: true, sms: true },
  messagesConsent: true,
  smsEnabled: true,
  smsTemplateRegistered: true,
  contact: { email: true, verifiedPhone: true },
};

function plan(overrides: Partial<DeliveryPlanInput>) {
  return planDelivery({ ...everythingOn, ...overrides });
}

describe("planDelivery()", () => {
  it("sends on every channel of the route when nothing stands in the way", () => {
    expect(plan({})).toEqual({
      deliver: ["email", "sms", "in_app"],
      suppressed: [],
    });
  });

  it("only uses the channels the route names", () => {
    expect(plan({ routeChannels: ["in_app"] })).toEqual({
      deliver: ["in_app"],
      suppressed: [],
    });
  });

  it("sends no SMS to a user who turned SMS off", () => {
    expect(plan({ preferences: { email: true, sms: false } })).toEqual({
      deliver: ["email", "in_app"],
      suppressed: [{ channel: "sms", reason: "preference_off" }],
    });
  });

  it("sends no email to a user who turned email off", () => {
    expect(plan({ preferences: { email: false, sms: true } })).toEqual({
      deliver: ["sms", "in_app"],
      suppressed: [{ channel: "email", reason: "preference_off" }],
    });
  });

  it("ignores preferences for a message required by law", () => {
    expect(
      plan({ requiredByLaw: true, preferences: { email: false, sms: false } })
    ).toEqual({ deliver: ["email", "sms", "in_app"], suppressed: [] });
  });

  it("never sends SMS while the SMS switch is off, even when required by law", () => {
    expect(plan({ smsEnabled: false, requiredByLaw: true })).toEqual({
      deliver: ["email", "in_app"],
      suppressed: [{ channel: "sms", reason: "sms_disabled" }],
    });
  });

  it("never sends an SMS whose template has no DLT registration", () => {
    expect(plan({ smsTemplateRegistered: false })).toEqual({
      deliver: ["email", "in_app"],
      suppressed: [{ channel: "sms", reason: "sms_unregistered" }],
    });
  });

  it("sends no SMS without a verified phone number", () => {
    expect(plan({ contact: { email: true, verifiedPhone: false } })).toEqual({
      deliver: ["email", "in_app"],
      suppressed: [{ channel: "sms", reason: "no_contact" }],
    });
  });

  it("covers an SMS-only message with email and in-app when SMS is off", () => {
    expect(plan({ routeChannels: ["sms"], smsEnabled: false })).toEqual({
      deliver: ["email", "in_app"],
      suppressed: [{ channel: "sms", reason: "sms_disabled" }],
    });
  });

  it("covers with email even for a user who chose SMS only", () => {
    expect(
      plan({
        routeChannels: ["sms"],
        smsEnabled: false,
        preferences: { email: false, sms: true },
      })
    ).toEqual({
      deliver: ["email", "in_app"],
      suppressed: [{ channel: "sms", reason: "sms_disabled" }],
    });
  });

  it("covers an SMS-only message for a user who turned SMS off", () => {
    expect(
      plan({ routeChannels: ["sms"], preferences: { email: true, sms: false } })
    ).toEqual({
      deliver: ["email", "in_app"],
      suppressed: [{ channel: "sms", reason: "preference_off" }],
    });
  });

  it("sends no email to a user without an email address", () => {
    expect(
      plan({
        routeChannels: ["email", "in_app"],
        contact: { email: false, verifiedPhone: true },
      })
    ).toEqual({
      deliver: ["in_app"],
      suppressed: [{ channel: "email", reason: "no_contact" }],
    });
  });

  it("keeps email and SMS from a user who withdrew consent to messages", () => {
    expect(plan({ messagesConsent: false })).toEqual({
      deliver: ["in_app"],
      suppressed: [
        { channel: "email", reason: "consent_withdrawn" },
        { channel: "sms", reason: "consent_withdrawn" },
      ],
    });
  });

  it("does not cover with email when consent to messages is withdrawn", () => {
    expect(plan({ routeChannels: ["sms"], messagesConsent: false })).toEqual({
      deliver: ["in_app"],
      suppressed: [
        { channel: "email", reason: "consent_withdrawn" },
        { channel: "sms", reason: "consent_withdrawn" },
      ],
    });
  });

  it("still sends a message required by law after consent is withdrawn", () => {
    expect(plan({ requiredByLaw: true, messagesConsent: false })).toEqual({
      deliver: ["email", "sms", "in_app"],
      suppressed: [],
    });
  });

  it("delivers nothing for a route with no channels", () => {
    expect(plan({ routeChannels: [] })).toEqual({
      deliver: [],
      suppressed: [],
    });
  });
});
