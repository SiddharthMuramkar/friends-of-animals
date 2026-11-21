// Which channels one message goes out on for one recipient. The dispatcher
// gathers the facts (the route, the user's choices and contacts, the SMS
// switch, the template's DLT registration) and this decides, so every rule
// about channels lives here and is tested as a table:
//
// - A message required by law ignores the user's channel choices and a
//   withdrawn consent to messages. Nothing overrides the SMS switch or a
//   missing DLT registration: no SMS reaches the SMS port while either
//   holds.
// - Any other message goes out on the route's channels that the user chose,
//   and on neither email nor SMS once consent to messages is withdrawn.
// - When a route asks for SMS and it does not go out, email and in-app
//   cover for it (unless consent is withdrawn).
// - In-app is the inbox, not a preference: it goes whenever the route (or
//   SMS cover) asks for it.
//
// Pure: no database, no clock.

import type { MessageChannel } from "./channels";

export type SuppressionReason =
  /** The user turned this channel off. */
  | "preference_off"
  /** The user withdrew consent to messages. */
  | "consent_withdrawn"
  /** The platform-wide SMS switch (`sms.enabled`) is off. */
  | "sms_disabled"
  /** The SMS template has no DLT template id, so operators would drop it. */
  | "sms_unregistered"
  /** No email address, or no verified phone number. */
  | "no_contact";

export type DeliveryPlanInput = {
  /** The channels the event's route asks for. */
  routeChannels: readonly MessageChannel[];
  requiredByLaw: boolean;
  preferences: { email: boolean; sms: boolean };
  messagesConsent: boolean;
  smsEnabled: boolean;
  /** The recipient-facing SMS template has a DLT template id. */
  smsTemplateRegistered: boolean;
  contact: { email: boolean; verifiedPhone: boolean };
};

export type DeliveryPlan = {
  /** Channels to send on, in the order email, sms, in_app. */
  deliver: MessageChannel[];
  /** Channels that were wanted but not sent, with the first reason why. */
  suppressed: { channel: MessageChannel; reason: SuppressionReason }[];
};

export function planDelivery(input: DeliveryPlanInput): DeliveryPlan {
  const wants = new Set(input.routeChannels);
  const optional = !input.requiredByLaw;
  const consentWithdrawn = optional && !input.messagesConsent;

  let smsReason: SuppressionReason | undefined;
  if (wants.has("sms")) {
    if (optional && !input.preferences.sms) smsReason = "preference_off";
    else if (consentWithdrawn) smsReason = "consent_withdrawn";
    else if (!input.smsEnabled) smsReason = "sms_disabled";
    else if (!input.smsTemplateRegistered) smsReason = "sms_unregistered";
    else if (!input.contact.verifiedPhone) smsReason = "no_contact";
  }
  const coverForSms = smsReason !== undefined;

  let emailReason: SuppressionReason | undefined;
  const wantsEmail = wants.has("email") || coverForSms;
  if (wantsEmail) {
    if (consentWithdrawn) emailReason = "consent_withdrawn";
    else if (optional && !input.preferences.email && !coverForSms) {
      emailReason = "preference_off";
    } else if (!input.contact.email) emailReason = "no_contact";
  }

  const plan: DeliveryPlan = { deliver: [], suppressed: [] };
  if (wantsEmail) {
    if (emailReason) {
      plan.suppressed.push({ channel: "email", reason: emailReason });
    } else {
      plan.deliver.push("email");
    }
  }
  if (wants.has("sms")) {
    if (smsReason) plan.suppressed.push({ channel: "sms", reason: smsReason });
    else plan.deliver.push("sms");
  }
  if (wants.has("in_app") || coverForSms) plan.deliver.push("in_app");
  return plan;
}
