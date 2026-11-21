import type { Clock } from "@/server/ports/clock";
import type { SmsMessage, SmsSender } from "@/server/ports/sms";

export class FakeSms implements SmsSender {
  constructor(_clock: Clock) {}
  async send(_message: SmsMessage): Promise<void> {
    throw new Error("not built yet");
  }
  get sent(): (SmsMessage & { sentAt: Date })[] {
    return [];
  }
  inbox(_to: string): (SmsMessage & { sentAt: Date })[] {
    return [];
  }
  lastTo(_to: string): (SmsMessage & { sentAt: Date }) | undefined {
    return undefined;
  }
  codeFor(_to: string): string | undefined {
    return undefined;
  }
  failNext(_count: number, _error?: Error): void {}
}
