// Shared set-up for #92's Seam 1 tests: an FOA verifier, an individual
// entry that reaches FOA when submissions close, and a school's shortlisted
// entries that reach FOA when its round is finalised. Test code only;
// nothing in the app imports it.

import { asc, eq } from "drizzle-orm";

import type { Actor } from "@/server/actor";
import { entry, entryTransition } from "@/server/db/schema";
import {
  confirmedAdult,
  submittedImage,
  type Participant,
} from "@/server/modules/entries/testing";
import { signedInWith } from "@/server/modules/judging/testing";
import {
  categoryOf,
  schoolInJudging,
  type RoundWorld,
} from "@/server/modules/school-round/testing";
import type { Harness } from "@/test/harness";

/** A signed-in FOA verifier who passed the second factor. */
export function signedInVerifier(h: Harness): Promise<Actor> {
  return signedInWith(h, { role: "foa_verifier", scope: { type: "global" } });
}

/** The seed builder's competitions close submissions 80 days on. */
export async function closeSubmissions(h: Harness, days = 81): Promise<void> {
  h.clock.advance({ days });
  await h.drain();
}

export async function entryIdOf(h: Harness, code: string): Promise<string> {
  const [row] = await h.db
    .select({ id: entry.id })
    .from(entry)
    .where(eq(entry.code, code));
  if (!row) throw new Error(`No entry ${code}`);
  return row.id;
}

export async function statusOf(h: Harness, entryId: string) {
  const [row] = await h.db
    .select({ status: entry.status })
    .from(entry)
    .where(eq(entry.id, entryId));
  return row?.status;
}

/** Every status the entry has been in, in order. */
export async function historyOf(h: Harness, entryId: string) {
  const rows = await h.db
    .select({ to: entryTransition.toStatus })
    .from(entryTransition)
    .where(eq(entryTransition.entryId, entryId))
    .orderBy(asc(entryTransition.sequence));
  return rows.map((row) => row.to);
}

export type IndividualEntry = Participant & { entryId: string; code: string };

/** An adult's submitted photograph, its file live; submissions still open. */
export async function submittedIndividualEntry(
  h: Harness,
  options: Parameters<typeof confirmedAdult>[1] = {}
): Promise<IndividualEntry> {
  const participant = await confirmedAdult(h, options);
  const code = await submittedImage(h, participant);
  await h.drain();
  return { ...participant, code, entryId: await entryIdOf(h, code) };
}

/** An adult's entry, forwarded to FOA when submissions closed. */
export async function individualEntryAtFoa(
  h: Harness
): Promise<IndividualEntry> {
  const submitted = await submittedIndividualEntry(h);
  await closeSubmissions(h);
  return submitted;
}

/**
 * A school whose round was finalised with students 1 and 2 shortlisted:
 * their entries are submitted to FOA; student 3's is not shortlisted.
 */
export async function schoolEntriesAtFoa(h: Harness): Promise<RoundWorld> {
  const world = await schoolInJudging(h, { students: 3, submit: [1, 2, 3] });
  const coordinator = h.as(world.coordinator.actor);
  await coordinator.recordPanel({
    ...world.ref,
    members: [{ fullName: "Lata Kulkarni", designation: "Art teacher" }],
  });
  const certified = await coordinator.certifyConduct(world.ref);
  if (!certified.ok) throw new Error(JSON.stringify(certified));
  const saved = await coordinator.saveShortlist({
    ...world.ref,
    categoryId: await categoryOf(h, world, "photography"),
    picks: [
      { entryId: world.entryIds[1]!, position: 1 },
      { entryId: world.entryIds[2]!, position: null },
    ],
  });
  if (!saved.ok) throw new Error(JSON.stringify(saved));
  const finalised = await coordinator.finaliseSchoolRound({
    ...world.ref,
    judgingAttested: true,
  });
  if (!finalised.ok) throw new Error(JSON.stringify(finalised));
  await h.drain();
  return world;
}
