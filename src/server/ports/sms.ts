// The SMS port. Use cases send through it and never pick a provider.

import type { E164Phone } from "../../lib/phone";

/** Every SMS FOA sends is a template registered under India's DLT rules. */
export type SmsTemplate = "sign-in-code";

export type SmsMessage = {
  to: E164Phone;
  template: SmsTemplate;
  vars: Record<string, string>;
  text: string;
};

export type ReceivedSms = { to: E164Phone; text: string; sentAt: Date };

export interface SmsSender {
  send(message: SmsMessage): Promise<void>;
}

export class SmsNotConfiguredError extends Error {}

export const unconfiguredSmsSender: SmsSender = {
  send: () => Promise.reject(new Error("not built yet")),
};
