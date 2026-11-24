// Shared set-up for #89's Seam 1 tests: a school whose students submitted
// entries, its competition moved into school judging by its real status
// jobs (rubrics published, the clock past submissions closing), and the
// round that opened. Test code only; nothing in the app imports it.

import { eq } from "drizzle-orm";

import type { Actor } from "@/server/actor";
import { competition, entry } from "@/server/db/schema";
import { submittedImage } from "@/server/modules/entries/testing";
import {
  confirmedSchool,
  type ConfirmedSchool,
} from "@/server/modules/institution-submissions/testing";
import { globalManager, signedInWith } from "@/server/modules/judging/testing";
import { signInCoordinator } from "@/server/modules/registration/testing";
import { EICAR_TEST_BYTES } from "@/test/eicar";
import { seedInstitution } from "@/test/institutions";
import type { Harness } from "@/test/harness";

import type { Discipline } from "../competitions/domain/vocabulary";

/** The disciplines of the seed builder's competitions. */
const DISCIPLINES: Discipline[] = ["drawing", "painting", "photography"];

/**
 * Publishes a rubric for each discipline, then moves the clock past
 * submissions closing (80 days on, by the builder's dates) and lets the
 * status jobs run: the competition enters school judging, and its rounds
 * open.
 */
export async function enterSchoolJudging(
  h: Harness,
  competitionId: string,
  { days = 81 }: { days?: number } = {}
): Promise<void> {
  const manager = await signedInWith(h, globalManager);
  for (const discipline of DISCIPLINES) {
    const draft = await h
      .as(manager)
      .createRubricDraft({ competitionId, discipline });
    if (!draft.ok) throw new Error(`createRubricDraft: ${draft.error}`);
    const published = await h
      .as(manager)
      .publishRubric({ rubricId: draft.rubric.id });
    if (!published.ok) throw new Error(`publishRubric: ${published.error}`);
  }
  await h.drain();
  h.clock.advance({ days });
  await h.drain();
  const [row] = await h.db
    .select({ status: competition.status })
    .from(competition)
    .where(eq(competition.id, competitionId));
  if (row?.status !== "school_judging") {
    throw new Error(`Competition is ${row?.status}, not school_judging`);
  }
}

export type RoundWorld = ConfirmedSchool & {
  /** The entry id of each confirmed student who submitted, by student (from 1). */
  entryIds: Record<number, string>;
  ref: { institutionId: string; reference: string };
  coordinator: { actor: Actor; userId: string };
};

/**
 * A school with `students` confirmed students; those listed in `submit`
 * (from 1) have a submitted photography entry, and `rejected` ones an
 * upload the malware scan refused. The competition is in school judging, so the
 * school's round is open.
 */
export async function schoolInJudging(
  h: Harness,
  {
    students = 3,
    submit = [1, 2],
    rejected = [],
    code,
    name,
    beforeJudging,
  }: {
    students?: number;
    submit?: number[];
    rejected?: number[];
    code?: string;
    name?: string;
    /** Runs while registration is still open, before school judging. */
    beforeJudging?: (school: ConfirmedSchool) => Promise<void>;
  } = {}
): Promise<RoundWorld> {
  const school = await confirmedSchool(h, {
    students,
    ...(code ? { code } : {}),
    ...(name ? { name } : {}),
  });
  const codes: Record<number, string> = {};
  for (const n of submit) {
    codes[n] = await submittedImage(h, school.forStudent(n));
  }
  for (const n of rejected) {
    codes[n] = await submittedImage(h, school.forStudent(n), {
      bytes: EICAR_TEST_BYTES,
    });
  }
  await h.drain();
  await beforeJudging?.(school);
  await enterSchoolJudging(h, school.competition.id);
  const entryIds: Record<number, string> = {};
  for (const [n, entryCode] of Object.entries(codes)) {
    const [row] = await h.db
      .select({ id: entry.id })
      .from(entry)
      .where(eq(entry.code, entryCode));
    entryIds[Number(n)] = row!.id;
  }
  return {
    ...school,
    entryIds,
    ref: { institutionId: school.institutionId, reference: school.reference },
  };
}

/**
 * Another verified school (`name`) registered by its own coordinator for
 * `competitionId`, while its registration is open, with no student yet.
 */
export async function anotherSchool(
  h: Harness,
  competitionId: string,
  name = "Other School"
) {
  const { institution } = await seedInstitution(h, { name });
  const coordinator = await signInCoordinator(h, institution.id);
  const registered = await h
    .as(coordinator.actor)
    .registerInstitutionForCompetition({
      institutionId: institution.id,
      competitionId,
    });
  if (!registered.ok)
    throw new Error(`Could not register: ${registered.error}`);
  return {
    institutionId: institution.id,
    coordinator,
    reference: registered.reference,
    registrationId: registered.registrationId,
    ref: { institutionId: institution.id, reference: registered.reference },
  };
}
