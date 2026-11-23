// listMyEntries() (#85): the entries on the participant dashboard. The
// signed-in member's own entries and, for a guardian, those of each child
// they look after (the same profiles as their registrations,
// ../../participants/list-my-registrations.ts), newest first, each with its
// Entry ID, its status and whether an upload is still being checked.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, desc, eq, exists, inArray } from "drizzle-orm";

import { authorize } from "../../../access/can";
import {
  competition,
  entry,
  entryFile,
  participantProfile,
} from "../../../db/schema";
import type { UseCaseContext } from "../../../use-cases";
import type { Discipline } from "../../competitions/domain/vocabulary";
import { visibleProfiles } from "../../participants/list-my-registrations";
import type { EntryStatus } from "../domain/status";

export type MyEntry = {
  code: string;
  status: EntryStatus;
  title: string;
  discipline: Discipline;
  competition: { name: string; slug: string };
  registrationId: string;
  participantName: string;
  /** The member's own, or a child's they look after as a guardian. */
  whose: "mine" | "child";
  /** An upload is waiting for its checks (the first file, or a replacement). */
  checking: boolean;
  submittedAt: Date | null;
};

export async function listMyEntries(ctx: UseCaseContext): Promise<MyEntry[]> {
  await authorize(ctx, "entry.list_mine");
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const visible = await visibleProfiles(ctx.db, ctx.actor.userId);
  if (visible.size === 0) return [];
  const checking = ctx.db
    .select({ id: entryFile.id })
    .from(entryFile)
    .where(
      and(
        eq(entryFile.entryId, entry.id),
        inArray(entryFile.status, ["pending", "processing"])
      )
    );
  const rows = await ctx.db
    .select({
      code: entry.code,
      status: entry.status,
      title: entry.title,
      discipline: entry.discipline,
      competitionName: competition.name,
      competitionSlug: competition.slug,
      registrationId: entry.registrationId,
      profileId: entry.participantProfileId,
      participantName: participantProfile.fullName,
      checking: exists(checking).mapWith(Boolean),
      submittedAt: entry.submittedAt,
    })
    .from(entry)
    .innerJoin(competition, eq(competition.id, entry.competitionId))
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, entry.participantProfileId)
    )
    .where(inArray(entry.participantProfileId, [...visible.keys()]))
    .orderBy(desc(entry.createdAt), desc(entry.id));
  return rows.map((row) => ({
    code: row.code,
    status: row.status,
    title: row.title,
    discipline: row.discipline,
    competition: { name: row.competitionName, slug: row.competitionSlug },
    registrationId: row.registrationId,
    participantName: row.participantName,
    whose: visible.get(row.profileId)!.whose,
    checking: row.checking,
    submittedAt: row.submittedAt,
  }));
}
