// Notifications seed data (#69): each seeded member's inbox (one message
// read, one unread) and channel choices. The templates and routes are not
// seed: a migration holds them (drizzle/*_69_notification_defaults.sql),
// so production has them too. Loads under plain Node (the seed script):
// relative imports only, no "server-only".

import { and, eq } from "drizzle-orm";

import {
  inboxItem,
  messageTemplate,
  notificationPreference,
  user,
} from "../db/schema";
import { renderTemplate } from "../notifications/domain/template";
import { DEFAULT_LOCALE } from "../notifications/locale";
import { normaliseEmailAddress } from "../ports/email";
import { SEED_ACCOUNTS } from "./accounts";
import type { SeedDeps } from "./types";

const HOUR = 60 * 60 * 1000;

/** Fixed ids, so seeding again adds nothing and keeps what was read. */
function itemId(member: number, item: number): string {
  return `01938a00-0000-7000-8069-0000000000${member}${item}`;
}

/** Member 2 chose email only; the others keep the defaults or both. */
const PREFERENCES: Record<number, { email: boolean; sms: boolean }> = {
  0: { email: true, sms: true },
  1: { email: true, sms: false },
};

export async function seedNotifications({ db, clock }: SeedDeps) {
  const now = clock.now();
  const [welcome] = await db
    .select({ subject: messageTemplate.subject, body: messageTemplate.body })
    .from(messageTemplate)
    .where(
      and(
        eq(messageTemplate.key, "identity.welcome"),
        eq(messageTemplate.channel, "in_app"),
        eq(messageTemplate.locale, DEFAULT_LOCALE)
      )
    );
  if (!welcome) throw new Error("The welcome template is missing");

  for (const [index, member] of SEED_ACCOUNTS.members.entries()) {
    // By address: someone may have signed up with it before the seed ran.
    const [account] = await db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(eq(user.email, normaliseEmailAddress(member.email)));
    if (!account) continue;
    const values = { "recipient.name": account.name };
    const welcomedAt = new Date(now.getTime() - 72 * HOUR);
    await db
      .insert(inboxItem)
      .values([
        {
          id: itemId(index + 1, 1),
          userId: account.id,
          templateKey: "identity.welcome",
          title: renderTemplate(welcome.subject ?? "", values),
          body: renderTemplate(welcome.body, values),
          createdAt: welcomedAt,
          readAt: new Date(welcomedAt.getTime() + HOUR),
        },
        {
          id: itemId(index + 1, 2),
          userId: account.id,
          templateKey: "seed.sample",
          title: "Monsoon art competition: entries are open",
          body: "Entries for the monsoon art competition are open until 30 November. Ask your school's coordinator how to take part.",
          link: "/competitions",
          createdAt: new Date(now.getTime() - 2 * HOUR),
        },
      ])
      .onConflictDoNothing({ target: inboxItem.id });

    const preferences = PREFERENCES[index];
    if (preferences) {
      await db
        .insert(notificationPreference)
        .values({ userId: account.id, ...preferences, updatedAt: now })
        .onConflictDoNothing({ target: notificationPreference.userId });
    }
  }
}
