import { parsePhoneNumber } from "@/lib/phone";
import type { Clock } from "@/server/ports/clock";
import type {
  ReceivedSms,
  SmsMessage,
  SmsSender,
  SmsTemplate,
} from "@/server/ports/sms";

/** A text as the fake keeps it: what was sent, and when. */
export type SentSms = ReceivedSms & {
  template: SmsTemplate;
  vars: Record<string, string>;
};

/** A number as typed, in E.164 when it is an Indian mobile. */
function canonical(typed: string): string {
  const parsed = parsePhoneNumber(typed);
  return parsed.ok ? parsed.e164 : typed;
}

/**
 * In-memory SMS for Seam 1 tests. It passes the same contract as the
 * capture adapter (src/server/ports/sms.contract.ts) and adds what tests
 * need: everything sent with its template and variables, the last message
 * to a number (typed any usual way), its code, and failures on demand.
 */
export class FakeSms implements SmsSender {
  readonly #clock: Clock;
  readonly #sent: SentSms[] = [];
  #failures: Error[] = [];

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  async send(message: SmsMessage): Promise<void> {
    const failure = this.#failures.shift();
    if (failure) throw failure;
    this.#sent.push({
      to: message.to,
      text: message.text,
      template: message.template,
      vars: { ...message.vars },
      sentAt: this.#clock.now(),
    });
  }

  /** Every message delivered so far, oldest first. */
  get sent(): readonly SentSms[] {
    return this.#sent;
  }

  /** One number's messages, newest first, with template and variables. */
  #messagesTo(to: string): SentSms[] {
    const number = canonical(to);
    return this.#sent.filter((message) => message.to === number).reverse();
  }

  /** One number's messages, newest first, as a mailbox lists them. */
  inbox(to: string): ReceivedSms[] {
    return this.#messagesTo(to).map(({ to: number, text, sentAt }) => ({
      to: number,
      text,
      sentAt,
    }));
  }

  /** The newest message to `to`, if any. */
  lastTo(to: string): SentSms | undefined {
    return this.#messagesTo(to)[0];
  }

  /** The sign-in code (six digits) in the newest message to `to`. */
  codeFor(to: string): string | undefined {
    return /\b(\d{6})\b/.exec(this.lastTo(to)?.text ?? "")?.[1];
  }

  /** Makes the next `count` sends reject with `error`; nothing is stored. */
  failNext(count: number, error = new Error("FakeSms: send failed")): void {
    this.#failures = Array.from({ length: count }, () => error);
  }
}
