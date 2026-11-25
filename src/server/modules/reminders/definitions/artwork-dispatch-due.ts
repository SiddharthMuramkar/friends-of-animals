import { and, eq, gt, ne } from "drizzle-orm";
import { physicalArtwork, competition } from "../../../db/schema";
import {
  ARTWORK_VARIABLES,
  artworkValues,
} from "../../physical-artwork/messages";
import type { ReminderDefinition } from "../registry";

export const artworkDispatchDue: ReminderDefinition = {
  name: "artwork_dispatch_due",
  subjectType: "physical_artwork",
  offsetSettings: ["artwork.dispatchReminderLeadHours"],
  templateKey: "reminders.artwork_dispatch_due",
  variables: ARTWORK_VARIABLES,
  async deadlineOf(db, id) {
    const [row] = await db
      .select({ work: physicalArtwork, competitionStatus: competition.status })
      .from(physicalArtwork)
      .innerJoin(competition, eq(competition.id, physicalArtwork.competitionId))
      .where(eq(physicalArtwork.id, id));
    if (!row) return { kind: "none" };
    if (row.competitionStatus === "cancelled") return { kind: "cancelled" };
    return row.work.status === "requested"
      ? { kind: "open", at: row.work.dispatchDeadline }
      : { kind: "none" };
  },
  async subjectsToSync(db, now) {
    return (
      await db
        .select({ id: physicalArtwork.id })
        .from(physicalArtwork)
        .innerJoin(
          competition,
          eq(competition.id, physicalArtwork.competitionId)
        )
        .where(
          and(
            eq(physicalArtwork.status, "requested"),
            gt(physicalArtwork.dispatchDeadline, now),
            ne(competition.status, "cancelled")
          )
        )
    ).map((r) => r.id);
  },
  async owes(db, { subjectId }) {
    const [row] = await db
      .select()
      .from(physicalArtwork)
      .where(eq(physicalArtwork.id, subjectId));
    return {
      kind: "competition_roster",
      competitionId: row?.competitionId ?? subjectId,
      groups:
        row?.status === "requested"
          ? [
              {
                registrationIds: new Set([row.registrationId]),
                roles: row.institutionRegistrationId
                  ? ["coordinator"]
                  : ["participant", "guardian"],
              },
            ]
          : [],
    };
  },
  values: artworkValues,
};
