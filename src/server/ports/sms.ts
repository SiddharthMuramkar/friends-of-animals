// The SMS port. Use cases send through it and never pick a provider.
// Adapters:
//   - capture (./sms-capture.ts): stores each message in the capture
//     mailbox; every environment except production.
//   - the in-memory fake (src/test/fakes/sms.ts): Seam 1 tests.
//   - MSG91 (./sms-msg91.ts): production, once FOA's DLT registration and
//     MSG91 keys exist; until then production gets `unconfiguredSmsSender`.
// The capture adapter and the fake pass ./sms.contract.ts.
//
// Loads under plain Node: relative imports only, no "server-only".

import type { E164Phone } from "../../lib/phone";

/**
 * Every SMS FOA sends uses a template registered under India's DLT rules,
 * named here; MSG91 knows each by its template id. `message` is any
 * message template staff edit (#69), which carries its own DLT id.
 */
export type SmsTemplate = "sign-in-code" | "message";

/**
 * One text message: the template and its variables (what MSG91 sends), and
 * the same message as plain text (what capture and the fake keep).
 */
export type SmsMessage = {
  to: E164Phone;
  template: SmsTemplate;
  vars: Record<string, string>;
  text: string;
  /**
   * The DLT template id the wording is registered under, for a `message`
   * (from message_template.dlt_template_id). The others are configured.
   */
  dltTemplateId?: string | undefined;
};

/** A message as a mailbox holds it. */
export type ReceivedSms = { to: E164Phone; text: string; sentAt: Date };

export interface SmsSender {
  /** Sends one message. Rejects if the provider refuses it. */
  send(message: SmsMessage): Promise<void>;
}

/** Thrown in production while MSG91 is not configured. */
export class SmsNotConfiguredError extends Error {
  constructor() {
    super(
      "No SMS provider is configured for production. MSG91 needs " +
        "MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID once FOA's DLT " +
        "registration is approved; codes are never captured in production."
    );
    this.name = "SmsNotConfiguredError";
  }
}

/** Production's sender until MSG91 is configured: refuses every message. */
export const unconfiguredSmsSender: SmsSender = {
  send: () => Promise.reject(new SmsNotConfiguredError()),
};
