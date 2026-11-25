// Shared set-up for #89's Seam 1 tests: a school whose students submitted
// entries, its competition moved into school judging by its real status
// jobs (rubrics published, the clock past submissions closing), and the
// round that opened. Test code only; nothing in the app imports it.

import { eq } from "drizzle-orm";

import type { Actor } from "@/server/actor";
import { competition, entry } from "@/server/db/schema";
import { PHOTO, submittedImage } from "@/server/modules/entries/testing";
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
    disciplines = {},
    code,
    name,
    beforeJudging,
  }: {
    students?: number;
    submit?: number[];
    rejected?: number[];
    /** A student's discipline, if not photography. */
    disciplines?: Record<number, Discipline>;
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
    codes[n] = await submittedImage(
      h,
      school.forStudent(n),
      disciplines[n] ? { discipline: disciplines[n] } : {}
    );
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

/** The round's category id for `discipline` (the students' 10–13 group). */
export async function categoryOf(
  h: Harness,
  world: RoundWorld,
  discipline: Discipline
): Promise<string> {
  const view = await h.as(world.coordinator.actor).getSchoolRound(world.ref);
  if (!view.ok) throw new Error(`No round: ${view.error}`);
  const found = view.round.categories.find(
    (category) => category.discipline === discipline
  );
  if (!found) throw new Error(`No ${discipline} category with entries`);
  return found.id;
}

/** Sets the competition's shortlist size and school positions. */
export async function setShortlistLimits(
  h: Harness,
  competitionId: string,
  limits: { shortlistSize?: number; positions?: number }
): Promise<void> {
  await h.db
    .update(competition)
    .set({
      ...(limits.shortlistSize === undefined
        ? {}
        : { shortlistPerCategory: limits.shortlistSize }),
      ...(limits.positions === undefined
        ? {}
        : { schoolPositions: limits.positions }),
    })
    .where(eq(competition.id, competitionId));
}

/**
 * #91: a school like `schoolInJudging`'s whose competition takes digital
 * work from the school shortlist only, so no student has an entry when the
 * round opens.
 */
export async function shortlistOnlySchool(
  h: Harness,
  {
    students = 3,
    beforeJudging,
  }: {
    students?: number;
    beforeJudging?: (school: ConfirmedSchool) => Promise<void>;
  } = {}
): Promise<RoundWorld> {
  return schoolInJudging(h, {
    students,
    submit: [],
    beforeJudging: async (school) => {
      await h.db
        .update(competition)
        .set({ digitalScope: "shortlist_only" })
        .where(eq(competition.id, school.competition.id));
      await beforeJudging?.(school);
    },
  });
}

/** Every declaration the create form asks for (#91). */
export const ALL_DECLARATIONS = [
  "original_work",
  "faithful_reproduction",
  "participation_covered",
  "physical_work_kept",
];

type ShortlistedOptions = {
  bytes?: Uint8Array;
  discipline?: string;
  position?: number | null;
  declarations?: string[];
  title?: string;
};

/** The first two browser steps of creating a shortlisted entry (#91). */
export async function putShortlistedEntry(
  h: Harness,
  world: RoundWorld,
  student: number,
  {
    bytes = PHOTO,
    discipline = "photography",
    position = null,
    declarations = ALL_DECLARATIONS,
    title = "Kites over the lake",
  }: ShortlistedOptions = {},
  actor: Actor = world.coordinator.actor
) {
  const registrationId = world.registrationIds[student - 1]!;
  const started = await h.as(actor).startShortlistedEntry({
    ...world.ref,
    registrationId,
    discipline,
    file: { name: "kites.jpg", type: "image/jpeg", size: bytes.length },
    // As a fresh form does: retire this coordinator's unfinished upload.
    restartPendingUpload: true,
  });
  if (!started.ok) throw new Error(`not started: ${JSON.stringify(started)}`);
  const stored = await h.storage.put(started.uploadUrl, bytes, started.headers);
  if (!stored.ok) throw new Error(`not stored: ${stored.error}`);
  return {
    ...world.ref,
    registrationId,
    discipline,
    fileId: started.fileId,
    title,
    description: "A photo of the painting the school judged.",
    position,
    declarations,
  };
}

/** Creates a shortlisted entry, which must succeed; returns its id and code. */
export async function createdEntry(
  h: Harness,
  world: RoundWorld,
  student: number,
  options: ShortlistedOptions = {}
): Promise<{ entryId: string; code: string }> {
  const completed = await h
    .as(world.coordinator.actor)
    .completeShortlistedEntry(
      await putShortlistedEntry(h, world, student, options)
    );
  if (!completed.ok) {
    throw new Error(`not completed: ${JSON.stringify(completed)}`);
  }
  const [row] = await h.db
    .select({ id: entry.id })
    .from(entry)
    .where(eq(entry.code, completed.entryCode));
  return { entryId: row!.id, code: completed.entryCode };
}
