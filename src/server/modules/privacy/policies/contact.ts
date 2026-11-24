import { and, asc, eq, gt, inArray, isNotNull } from "drizzle-orm";

import { contactMessage, contactNote, user } from "../../../db/schema";
import {
  CONTACT_RETENTION_POLICY,
  contactPastRetention,
} from "../../contact/inventory";
import { CONTACT_RETENTION } from "../domain/periods";
import { nextCursor, type RetentionPolicy } from "./types";

export const CONTACT_MESSAGES: RetentionPolicy = {
  key: CONTACT_RETENTION_POLICY.key,
  table: CONTACT_RETENTION_POLICY.table,
  action: CONTACT_RETENTION_POLICY.action,
  period: { kind: "calendar", settingKey: CONTACT_RETENTION.settingKey },
  async candidates(db, { now, months, after, limit }) {
    const messages = await db
      .select({
        id: contactMessage.id,
        assignee: contactMessage.assignedToUserId,
        sender: user.id,
      })
      .from(contactMessage)
      .leftJoin(user, eq(user.email, contactMessage.email))
      .where(
        and(
          contactPastRetention(now, months),
          after === null ? undefined : gt(contactMessage.id, after.id)
        )
      )
      .orderBy(asc(contactMessage.id))
      .limit(limit)
      .for("update", { of: contactMessage });
    if (messages.length === 0) return { candidates: [], next: null };

    // Read notes after locking the parents, so a note committed while the
    // sweep waited for a lock participates in that message's legal holds.
    const notes = await db
      .selectDistinct({
        id: contactNote.messageId,
        author: contactNote.authorUserId,
      })
      .from(contactNote)
      .where(
        and(
          inArray(
            contactNote.messageId,
            messages.map(({ id }) => id)
          ),
          isNotNull(contactNote.authorUserId)
        )
      );
    const authorsByMessage = new Map<string, string[]>();
    for (const { id, author } of notes) {
      if (author !== null) {
        const authors = authorsByMessage.get(id) ?? [];
        authors.push(author);
        authorsByMessage.set(id, authors);
      }
    }
    const candidates = messages.map(({ id, assignee, sender }) => {
      const users = new Set(authorsByMessage.get(id));
      if (assignee !== null) users.add(assignee);
      if (sender !== null) users.add(sender);
      return {
        id,
        // The message has already reached its calendar retention date.
        anchor: now,
        subjects: [...users].map((userId) => ({ type: "user", id: userId })),
      };
    });
    return { candidates, next: nextCursor(messages, limit) };
  },
  async apply(db, ids) {
    if (ids.length > 0) {
      // The selected parents are locked until this delete and its cascade.
      await db
        .delete(contactMessage)
        .where(inArray(contactMessage.id, [...ids]));
    }
  },
};
