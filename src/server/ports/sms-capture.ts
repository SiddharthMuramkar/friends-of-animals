// The capture adapter for the SMS port: every environment except
// production stores each text in the capture mailbox (channel "sms")
// instead of sending it, so no real SMS leaves staging, previews or a local
// run, and staff and the Seam 2 journeys can read sign-in codes.
//
// Loads under plain Node (seed script), so no "server-only" here.

import { and, desc, eq, gte } from "drizzle-orm";

import type { E164Phone } from "../../lib/phone";
import type { DbWithClock } from "../db/app-db";
import { capturedMessage } from "../db/schema";
import { sqlState } from "../errors";
import { monotonicUuidv7 } from "../ids";
import { captureMailboxSince, CaptureFailedError } from "./email-capture";
import type { ReceivedSms, SmsSender } from "./sms";

export function captureSmsSender({ db, clock }: DbWithClock): SmsSender {
  // Messages sent in the same millisecond get ids in send order, which
  // readCapturedSms sorts by after the time.
  const nextId = monotonicUuidv7();
  return {
    async send(message) {
      const now = clock.now();
      try {
        await db.insert(capturedMessage).values({
          id: nextId(now),
          channel: "sms",
          toAddress: message.to,
          bodyText: message.text,
          createdAt: now,
        });
      } catch (error) {
        // Deliberately without `cause`: the query's error lists the number
        // and the body with its code.
        throw new CaptureFailedError("store a message", sqlState(error));
      }
    },
  };
}

/**
 * One phone's captured texts from the last week, newest first (at most
 * `limit`).
 */
export async function readCapturedSms(
  { db, clock }: DbWithClock,
  { to, limit = 20 }: { to: E164Phone; limit?: number }
): Promise<ReceivedSms[]> {
  let rows;
  try {
    rows = await db
      .select()
      .from(capturedMessage)
      .where(
        and(
          eq(capturedMessage.channel, "sms"),
          eq(capturedMessage.toAddress, to),
          gte(capturedMessage.createdAt, captureMailboxSince(clock.now()))
        )
      )
      .orderBy(desc(capturedMessage.createdAt), desc(capturedMessage.id))
      .limit(limit);
  } catch (error) {
    // The query's error lists the number: keep only the SQLSTATE.
    throw new CaptureFailedError("read messages", sqlState(error));
  }
  return rows.map((row) => ({
    to: row.toAddress as E164Phone,
    text: row.bodyText,
    sentAt: row.createdAt,
  }));
}
