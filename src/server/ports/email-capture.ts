// The capture adapter for the email port: every environment except
// production stores each message in the capture mailbox instead of sending
// it, so no real email leaves staging, previews or a local run, and staff and
// the Seam 2 journeys can read sign-in codes.
//
// Loads under plain Node (seed script), so no "server-only" here.

import { and, desc, eq } from "drizzle-orm";

import type { AppDb } from "../db/app-db";
import { capturedMessage } from "../db/schema";
import { uuidv7 } from "../ids";
import type { Clock } from "./clock";
import {
  normaliseEmailAddress,
  type EmailSender,
  type ReceivedEmail,
} from "./email";

export function captureEmailSender({
  db,
  clock,
}: {
  db: AppDb;
  clock: Clock;
}): EmailSender {
  return {
    async send(message) {
      const now = clock.now();
      await db.insert(capturedMessage).values({
        id: uuidv7(now),
        channel: "email",
        toAddress: normaliseEmailAddress(message.to),
        subject: message.subject,
        bodyText: message.text,
        bodyHtml: message.html ?? null,
        createdAt: now,
      });
    },
  };
}

/** One recipient's captured emails, newest first (at most `limit`). */
export async function readCapturedEmail(
  db: AppDb,
  { to, limit = 20 }: { to: string; limit?: number }
): Promise<ReceivedEmail[]> {
  const rows = await db
    .select()
    .from(capturedMessage)
    .where(
      and(
        eq(capturedMessage.channel, "email"),
        eq(capturedMessage.toAddress, normaliseEmailAddress(to))
      )
    )
    .orderBy(desc(capturedMessage.createdAt), desc(capturedMessage.id))
    .limit(limit);
  return rows.map((row) => ({
    to: row.toAddress,
    subject: row.subject ?? "",
    text: row.bodyText,
    ...(row.bodyHtml === null ? {} : { html: row.bodyHtml }),
    sentAt: row.createdAt,
  }));
}
