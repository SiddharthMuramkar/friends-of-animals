// Retention for messages (#57, #69) and background jobs (#61): captured
// messages in local runs and previews, the log of each message sent, the
// in-app messages a person has read, and outbox jobs that ran. A job that
// failed stays until staff resolve it.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import {
  capturedMessage,
  inboxItem,
  legalHold,
  messageDelivery,
  outbox,
  user,
} from "../../../db/schema";
import { USER_PHONE } from "../../../identity/stored-phone";
import { rowPolicy } from "./define";
import { dispatchedSubjects } from "./outbox-subjects";
import type { RetentionPolicy } from "./types";

const capturedRows = rowPolicy({
  key: "capturedMessages",
  table: capturedMessage,
  action: "delete",
  period: "capturedMessages",
  anchor: capturedMessage.createdAt,
  orderByAnchor: true,
});

export const CAPTURED_MESSAGES: RetentionPolicy = {
  ...capturedRows,
  async candidates(db, query) {
    const page = await capturedRows.candidates(db, query);
    if (page.candidates.length === 0) return page;

    const recipients = await db
      .select({ id: user.id, email: user.email, phoneHash: user.phoneHash })
      .from(legalHold)
      .innerJoin(user, eq(user.id, legalHold.subjectId))
      .where(
        and(eq(legalHold.subjectType, "user"), isNull(legalHold.releasedAt))
      );
    if (recipients.length === 0) return page;

    const messages = await db
      .select({
        id: capturedMessage.id,
        channel: capturedMessage.channel,
        address: capturedMessage.toAddress,
      })
      .from(capturedMessage)
      .where(
        inArray(
          capturedMessage.id,
          page.candidates.map(({ id }) => id)
        )
      );
    const byEmail = new Map(recipients.map(({ email, id }) => [email, id]));
    const byPhone = new Map(
      recipients.map(({ phoneHash, id }) => [phoneHash, id])
    );
    const ownerByMessage = new Map(
      messages.map(({ id, channel, address }) => [
        id,
        channel === "email"
          ? byEmail.get(address)
          : byPhone.get(query.blindIndex.of(USER_PHONE, address)),
      ])
    );
    return {
      ...page,
      candidates: page.candidates.map((candidate) => {
        const owner = ownerByMessage.get(candidate.id);
        return owner
          ? { ...candidate, subjects: [{ type: "user", id: owner }] }
          : candidate;
      }),
    };
  },
};

export const MESSAGE_DELIVERIES = rowPolicy({
  key: "messageDeliveries",
  table: messageDelivery,
  action: "delete",
  period: "messageDeliveries",
  anchor: messageDelivery.createdAt,
  subjects: [["user", messageDelivery.userId]],
});

/** Unread messages stay while the account is open. */
export const READ_INBOX_ITEMS = rowPolicy({
  key: "readInboxItems",
  table: inboxItem,
  action: "delete",
  period: "readInboxItems",
  anchor: inboxItem.readAt,
  where: isNotNull(inboxItem.readAt),
  subjects: [["user", inboxItem.userId]],
});

const dispatchedRows = rowPolicy({
  key: "dispatchedOutbox",
  table: outbox,
  action: "delete",
  period: "dispatchedOutbox",
  anchor: outbox.dispatchedAt,
  orderByAnchor: true,
  // The outbox check constraint requires these rows to be dispatched.
  where: isNotNull(outbox.dispatchedAt),
  subjects: [[outbox.aggregateType, outbox.aggregateId]],
});

export const DISPATCHED_OUTBOX: RetentionPolicy = {
  ...dispatchedRows,
  async candidates(db, query) {
    const page = await dispatchedRows.candidates(db, query);
    if (page.candidates.length === 0) return page;
    const subjects = await dispatchedSubjects(
      db,
      page.candidates.map(({ id }) => id)
    );
    return {
      ...page,
      candidates: page.candidates.map((candidate) => ({
        ...candidate,
        subjects: [
          ...candidate.subjects,
          ...(subjects.get(candidate.id) ?? []),
        ],
      })),
    };
  },
};
