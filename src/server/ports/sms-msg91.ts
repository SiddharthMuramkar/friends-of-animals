// The MSG91 adapter for the SMS port: production's sender once FOA's DLT
// registration is approved (HR-14). It calls MSG91's flow API
// (https://docs.msg91.com/sms/send-sms): POST the template id and, per
// recipient, the number (country code, no "+") and the template's
// variables, named as in the template (case-sensitive). The sender ID is
// mapped to the template in the MSG91 panel, so the request doesn't name
// it. MSG91 can answer 200 with {"type":"error"}, so the body decides.
//
// `fetch` is injected, so tests never touch the network.

import type { SmsSender, SmsTemplate } from "./sms";

export const MSG91_FLOW_URL = "https://control.msg91.com/api/v5/flow";

/** How long to wait for MSG91 before telling the visitor it failed. */
const TIMEOUT_MS = 10_000;

export type Msg91Config = {
  authKey: string;
  /**
   * MSG91's template id for each configured FOA template. A `message`
   * brings its own (SmsMessage.dltTemplateId).
   */
  templates: Partial<
    Record<Exclude<SmsTemplate, "message">, string | undefined>
  >;
};

/**
 * MSG91 didn't take the message. The message never holds the number, the
 * text or the key; MSG91's own reason is kept with any long digit run (a
 * number) masked.
 */
export class Msg91Error extends Error {
  constructor(problem: string) {
    super(`MSG91 SMS failed: ${problem}`);
    this.name = "Msg91Error";
  }
}

function masked(reason: string): string {
  return reason.replace(/\d{6,}/g, "[number]").slice(0, 200);
}

export function msg91SmsSender(
  { authKey, templates }: Msg91Config,
  fetchImpl: typeof fetch = fetch
): SmsSender {
  return {
    async send(message) {
      const templateId =
        message.template === "message"
          ? message.dltTemplateId
          : templates[message.template];
      if (!templateId) {
        throw new Msg91Error(`no DLT template id for ${message.template}`);
      }
      let response: Response;
      try {
        response = await fetchImpl(MSG91_FLOW_URL, {
          method: "POST",
          headers: {
            accept: "application/json",
            authkey: authKey,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            template_id: templateId,
            short_url: "0",
            recipients: [{ ...message.vars, mobiles: message.to.slice(1) }],
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        // Without `cause`: a network error can carry the request.
        const kind = error instanceof Error ? error.name : typeof error;
        throw new Msg91Error(`could not reach MSG91 (${kind})`);
      }
      if (!response.ok) {
        throw new Msg91Error(`HTTP ${response.status}`);
      }
      const body: unknown = await response.json().catch(() => null);
      const reply =
        typeof body === "object" && body !== null
          ? (body as { type?: unknown; message?: unknown })
          : {};
      if (reply.type !== "success") {
        const reason =
          typeof reply.message === "string" ? masked(reply.message) : "";
        throw new Msg91Error(`MSG91 refused the message. ${reason}`.trim());
      }
    },
  };
}
