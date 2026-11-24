// Breach log seed data (#116): two made-up breaches a preview's breach log
// can show, led by the seeded staff admin. One is still open; the other was
// contained and its two affected members were told (one notice row per
// channel each). Ids are fixed and times are counted back from the clock
// the first time the seed runs, so seeding again changes nothing. Seed data
// sends nothing and writes no audit entry. Loads under plain Node (the seed
// script): relative imports only, no "server-only".

import { inArray } from "drizzle-orm";

import {
  breachNotification,
  breachRecord,
  breachTimelineEvent,
  user,
} from "../db/schema";
import { sealBreachText } from "../modules/breaches/content";
import { SEED_ACCOUNTS } from "./accounts";
import type { SeedDeps } from "./types";

const HOUR = 60 * 60 * 1000;

export const SEED_BREACHES = {
  open: {
    id: "01938a00-0000-7000-8000-00000000b161",
    title: "Volunteer sign-up sheet shared in a public chat",
    impact:
      "A spreadsheet of volunteer names and phone numbers was posted in a public chat group for about an hour before it was taken down.",
    hoursAgo: 6,
    timeline: [
      { id: "01938a00-0000-7000-8000-00000000b171", kind: "recorded" },
    ],
  },
  notified: {
    id: "01938a00-0000-7000-8000-00000000b162",
    title: "Entry export emailed to the wrong school",
    impact:
      "An export of two members' entries, with their names and email addresses, was emailed to another school's coordinator, who deleted it.",
    note: "The other school confirmed in writing that they deleted the email.",
    hoursAgo: 72,
    timeline: [
      { id: "01938a00-0000-7000-8000-00000000b172", kind: "recorded" },
      { id: "01938a00-0000-7000-8000-00000000b173", kind: "contained" },
      {
        id: "01938a00-0000-7000-8000-00000000b174",
        kind: "principals_notified",
      },
      { id: "01938a00-0000-7000-8000-00000000b175", kind: "note" },
    ],
    notices: [
      {
        recipientEmail: SEED_ACCOUNTS.members[0].email,
        ids: [
          "01938a00-0000-7000-8000-00000000b181",
          "01938a00-0000-7000-8000-00000000b182",
        ],
      },
      {
        recipientEmail: SEED_ACCOUNTS.members[2].email,
        ids: [
          "01938a00-0000-7000-8000-00000000b183",
          "01938a00-0000-7000-8000-00000000b184",
        ],
      },
    ],
  },
} as const;

/** The open breach and the notified one, unless they exist already. */
export async function seedBreaches(deps: SeedDeps): Promise<void> {
  const { db, cipher, clock } = deps;
  const now = clock.now();
  // The identity seed preserves an account that already uses a seeded address.
  const accounts = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(
      inArray(
        user.email,
        SEED_ACCOUNTS.members.map(({ email }) => email)
      )
    );
  const accountIds = new Map(accounts.map(({ id, email }) => [email, id]));
  const lead = accountIds.get(SEED_ACCOUNTS.members[1].email) ?? null;
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * HOUR);

  const open = SEED_BREACHES.open;
  const openAware = at(open.hoursAgo);
  const [openCreated] = await db
    .insert(breachRecord)
    .values({
      id: open.id,
      title: sealBreachText(cipher, "title", open.title),
      awareAt: openAware,
      severity: "medium",
      personalDataInvolved: true,
      minorsAffected: false,
      affectedCount: 12,
      impact: sealBreachText(cipher, "impact", open.impact),
      status: "open",
      leadUserId: lead,
      createdAt: openAware,
      updatedAt: openAware,
    })
    .onConflictDoNothing()
    .returning({ id: breachRecord.id });
  if (openCreated) {
    await db.insert(breachTimelineEvent).values({
      ...open.timeline[0],
      breachId: open.id,
      authorUserId: lead,
      occurredAt: openAware,
    });
  }

  const told = SEED_BREACHES.notified;
  const aware = at(told.hoursAgo);
  const contained = at(told.hoursAgo - 4);
  const notified = at(told.hoursAgo - 20);
  const [created] = await db
    .insert(breachRecord)
    .values({
      id: told.id,
      title: sealBreachText(cipher, "title", told.title),
      awareAt: aware,
      severity: "high",
      personalDataInvolved: true,
      minorsAffected: false,
      affectedCount: 2,
      impact: sealBreachText(cipher, "impact", told.impact),
      status: "notified",
      containedAt: contained,
      principalsNotifiedAt: notified,
      leadUserId: lead,
      createdAt: aware,
      updatedAt: notified,
    })
    .onConflictDoNothing()
    .returning({ id: breachRecord.id });
  if (!created) return;
  const [recorded, containedEvent, notifiedEvent, note] = told.timeline;
  await db.insert(breachTimelineEvent).values([
    { ...recorded, breachId: told.id, authorUserId: lead, occurredAt: aware },
    {
      ...containedEvent,
      breachId: told.id,
      authorUserId: lead,
      occurredAt: contained,
    },
    {
      ...notifiedEvent,
      breachId: told.id,
      authorUserId: lead,
      occurredAt: notified,
    },
    {
      ...note,
      breachId: told.id,
      note: sealBreachText(cipher, "note", told.note),
      authorUserId: lead,
      occurredAt: at(told.hoursAgo - 24),
    },
  ]);
  await db.insert(breachNotification).values(
    told.notices.flatMap((notice) =>
      (["email", "in_app"] as const).map((channel, index) => ({
        id: notice.ids[index]!,
        breachId: told.id,
        recipientUserId: accountIds.get(notice.recipientEmail) ?? null,
        channel,
        recipientRole: "principal" as const,
        aboutCount: 1,
        queuedAt: notified,
        sentAt: notified,
      }))
    )
  );
}
