import type { E164Phone } from "../../lib/phone";
import type { DbWithClock } from "../db/app-db";
import type { ReceivedSms, SmsSender } from "./sms";

export function captureSmsSender(_deps: DbWithClock): SmsSender {
  return { send: () => Promise.reject(new Error("not built yet")) };
}

export async function readCapturedSms(
  _deps: DbWithClock,
  _query: { to: E164Phone; limit?: number }
): Promise<ReceivedSms[]> {
  throw new Error("not built yet");
}
