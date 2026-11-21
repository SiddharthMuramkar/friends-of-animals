// The capture adapter for the email port: every environment except
// production stores each message in the capture mailbox instead of sending
// it, so no real email leaves staging, previews or a local run, and staff and
// the Seam 2 journeys can read sign-in codes.
//
// Loads under plain Node (seed script), so no "server-only" here.

import { and, desc, eq, gte, lt } from "drizzle-orm";

import type { DbWithClock } from "../db/app-db";
import { capturedMessage } from "../db/schema";
import { sqlState } from "../errors";
import { monotonicUuidv7 } from "../ids";
import {
  normaliseEmailAddress,
  type EmailSender,
  type ReceivedEmail,
} from "./email";

/**
 * How long the capture mailbox keeps a message. Staging captures real
 * visitors' addresses and codes, and staff or a Seam 2 journey read a code
 * within minutes, so a week is plenty. Each send drops older messages, of
 * every channel, and reading never returns them.
 */
export const CAPTURE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Messages captured at or after this instant are still kept. */
function keptSince(now: Date): Date {
  return new Date(now.getTime() - CAPTURE_RETENTION_MS);
}

/**
 * The capture mailbox couldn't store a message. Only the Postgres error
 * code survives: the database's error (a DrizzleQueryError) lists the
 * query's parameters, the address and the body with its sign-in code, and
 * whatever logs this error must not see them.
 */
export class CaptureFailedError extends Error {
  readonly code: string | undefined;

  constructor(code: string | undefined) {
    super(
      `The capture mailbox could not store a message` +
        (code ? ` (Postgres ${code}).` : ".")
    );
    this.name = "CaptureFailedError";
    this.code = code;
  }
}

export function captureEmailSender({ db, clock }: DbWithClock): EmailSender {
  // Messages sent in the same millisecond (a code sent again at once, or a
  // test that never advances its clock) get ids in send order, which
  // readCapturedEmail sorts by after the time.
  const nextId = monotonicUuidv7();
  return {
    async send(message) {
      const now = clock.now();
      try {
        await db
          .delete(capturedMessage)
          .where(lt(capturedMessage.createdAt, keptSince(now)));
        await db.insert(capturedMessage).values({
          id: nextId(now),
          channel: "email",
          toAddress: normaliseEmailAddress(message.to),
          subject: message.subject,
          bodyText: message.text,
          bodyHtml: message.html ?? null,
          createdAt: now,
        });
      } catch (error) {
        // Deliberately without `cause`: see CaptureFailedError.
        throw new CaptureFailedError(sqlState(error));
      }
    },
  };
}

/**
 * One recipient's captured emails from the last week, newest first (at
 * most `limit`).
 */
export async function readCapturedEmail(
  { db, clock }: DbWithClock,
  { to, limit = 20 }: { to: string; limit?: number }
): Promise<ReceivedEmail[]> {
  const rows = await db
    .select()
    .from(capturedMessage)
    .where(
      and(
        eq(capturedMessage.channel, "email"),
        eq(capturedMessage.toAddress, normaliseEmailAddress(to)),
        gte(capturedMessage.createdAt, keptSince(clock.now()))
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
