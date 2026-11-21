import type { SmsSender, SmsTemplate } from "./sms";

export const MSG91_FLOW_URL = "";

export function msg91SmsSender(
  _config: { authKey: string; templates: Record<SmsTemplate, string> },
  _fetch: typeof fetch = fetch
): SmsSender {
  return { send: () => Promise.reject(new Error("not built yet")) };
}
