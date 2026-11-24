// What a privacy request's messages may say, and who receives them (#115).
// #69's dispatcher reads these through the audiences in
// src/server/modules/notifications/audiences.ts:
//
//   privacy_requester    whoever filed the request: their receipt, a refusal
//                        and the outcome (for a guardian's filing, the
//                        guardian)
//   grievance_officers   every grievance officer: a new request came in
//   grievance_digest     the officer one overdue digest is for
//
// A message names the request by its reference, its kind in plain words
// and its due date: never what the requester wrote, the reason, or whose
// data it is, so a shared inbox or a lock screen shows nothing more.
//
// Loads under plain Node (the worker): relative imports only.

import { eq } from "drizzle-orm";
import { createFormatter, createTranslator } from "next-intl";

import privacyRequestMessages from "../../../../../messages/en-IN/privacyRequests.json";
import { formats, LOCALE } from "../../../../i18n/formats";
import type { AppDb } from "../../../db/app-db";
import { privacyRequest } from "../../../db/schema";

/** The variables a request's own messages may use. */
export const REQUEST_VARIABLES = [
  "request.reference",
  "request.type",
  "request.dueDate",
] as const;

/** The variables the overdue digest may use. */
export const DIGEST_VARIABLES = [
  "digest.overdue",
  "digest.assignedToYou",
] as const;

// A missing word fails the delivery loudly rather than mailing the key.
function refuseFallback(error: Error): never {
  throw error;
}
const typeWords = createTranslator({
  locale: LOCALE,
  messages: privacyRequestMessages,
  namespace: "privacyRequests.messageTypes",
  onError: refuseFallback,
});
const format = createFormatter({
  locale: LOCALE,
  formats,
  timeZone: "Asia/Kolkata",
});

/** The request's reference, kind and due date, read when the message goes. */
export async function requestValues(
  db: AppDb,
  requestId: string
): Promise<Record<string, string>> {
  const [row] = await db
    .select({
      reference: privacyRequest.reference,
      type: privacyRequest.type,
      dueAt: privacyRequest.dueAt,
    })
    .from(privacyRequest)
    .where(eq(privacyRequest.id, requestId));
  if (!row) return {};
  return {
    "request.reference": row.reference,
    "request.type": typeWords(row.type),
    "request.dueDate": format.dateTime(row.dueAt, "long"),
  };
}

/** Whoever filed the request, while their account exists. */
export async function requesterOf(
  db: AppDb,
  requestId: string
): Promise<string[]> {
  const [row] = await db
    .select({ userId: privacyRequest.requestedByUserId })
    .from(privacyRequest)
    .where(eq(privacyRequest.id, requestId));
  return row?.userId ? [row.userId] : [];
}

/** The digest's counts, from its payload. */
export function digestValues(payload: {
  overdue: number;
  assignedToYou: number;
}): Record<string, string> {
  return {
    "digest.overdue": String(payload.overdue),
    "digest.assignedToYou": String(payload.assignedToYou),
  };
}
