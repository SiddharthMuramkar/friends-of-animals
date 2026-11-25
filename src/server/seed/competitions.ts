// Competitions seed data (#70): three published competitions at the sample
// content's links, one per way of taking part, and one draft, the seeded
// competition scope (SEED_SCOPES.competition) that a judge is granted on.
// The published ones are one per status the schedule moves through (#71):
// their key dates are set from the seed clock, so each date agrees with
// its status whenever a preview is seeded. Two more, past registration
// and open for submissions, hold the entries seed's examples (#85), and a
// third takes the seeded school's entries (#87).
// Also two global competition managers with the seed authenticator (#60's
// SEED_TOTP_SECRET), so previews can run the admin pages.
// Loads under plain Node (the seed script): relative imports only, no
// "server-only".

import type { DbWithClock } from "../db/app-db";
import { competition } from "../db/schema";
import { ensureVerifiedAccount } from "../identity/verified-account";
import { uuidv7 } from "../ids";
import { instantToIstLocal } from "../modules/competitions/domain/ist";
import { competitionSlugCandidates } from "../modules/competitions/domain/slug";
import { statusJobs } from "../modules/competitions/domain/status-schedule";
import type { CompetitionStatus } from "../modules/competitions/domain/vocabulary";
import {
  DEFAULT_FIELDS,
  parseFields,
  type CompetitionFields,
} from "../modules/competitions/fields";
import { saveStatusJobs } from "../modules/competitions/status-jobs";
import {
  columnsOf,
  replaceAgeGroups,
  replaceKeyDates,
} from "../modules/competitions/store";
import { ensureGrant } from "./access";
import { SEED_SCOPES } from "./scopes";
import { ensureSeedAuthenticator } from "./second-factor";
import type { SeedDeps } from "./types";

/**
 * A preview's competition managers, global, each signing in by email code
 * and passing the second factor with the seed authenticator. Two, so the
 * desktop and mobile journeys never type the same authenticator's code: a
 * code works once.
 */
export const SEED_COMPETITION_MANAGERS = [
  {
    id: "01938a00-0000-7000-8000-000000000201",
    name: "Seed Competition Manager",
    email: "competition-manager@example.test",
  },
  {
    id: "01938a00-0000-7000-8000-000000000202",
    name: "Seed Competition Manager Two",
    email: "competition-manager-2@example.test",
  },
] as const;

/** The first seeded competition manager. */
export const SEED_COMPETITION_MANAGER = SEED_COMPETITION_MANAGERS[0];

const AGE_GROUPS = [
  { label: "Group A", minAge: 5, maxAge: 8 },
  { label: "Group B", minAge: 9, maxAge: 12 },
  { label: "Group C", minAge: 13, maxAge: 17 },
];

/** For a competition adults may enter on their own (#78). */
const ADULT_AGE_GROUP = { label: "Adults", minAge: 18, maxAge: 99 };

const COMMON = {
  welfareMessage:
    "Animals share our streets, parks and skies. Clean water, shade and a gentle hand keep them safe.",
  rules:
    "One original artwork per participant, made by the participant alone. No tracing, no AI-generated work. Write your name and registration number on the back.",
  permittedMaterials:
    "Pencil, crayon, oil pastel, watercolour or poster colour on A3 paper. Essays handwritten or typed, up to 500 words.",
  duration: "2 hours",
  ageGroups: AGE_GROUPS,
} satisfies Partial<CompetitionFields>;

export type SeedCompetition = {
  id: string;
  slug: string;
  publishedAt: Date | null;
  fields: Omit<CompetitionFields, "categories"> &
    Partial<Pick<CompetitionFields, "categories">>;
} & (
  | { status: "cancelled"; cancelled: { at: Date; reason: string } }
  | { status: Exclude<CompetitionStatus, "cancelled">; cancelled?: never }
);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Open for submissions, with registration already closed, for the entries
 * seed (#85): Asha's processing and rejected examples are entered here,
 * and Ravi's video and typed essay (#86).
 */
export const SEED_ENTRY_COMPETITIONS = [
  {
    id: "01938a00-0000-7000-8000-000000008501",
    code: "ROOF27",
    slug: "life-on-the-rooftops",
    name: "Life on the Rooftops",
    theme:
      "Draw or film an animal you see from your rooftop and what makes that space safe for it.",
    disciplines: ["drawing", "videography"],
  },
  {
    id: "01938a00-0000-7000-8000-000000008502",
    code: "BIRDS27",
    slug: "birds-in-our-gardens",
    name: "Birds in Our Gardens",
    theme:
      "Draw or write about a bird that visits your neighbourhood and the plants it depends on.",
    disciplines: ["drawing", "essay"],
  },
] as const;

/**
 * Taking institutions only, past registration and open for submissions,
 * free, with digital work from every participant, for the school-route
 * submissions seed (#87): the verified institution's students, some with
 * entries, and the coordinator's roster.
 */
export const SEED_SCHOOL_SUBMISSIONS_COMPETITION = {
  id: "01938a00-0000-7000-8000-000000008701",
  code: "TREES27",
  slug: "trees-for-birds",
  name: "Trees for Birds",
  theme:
    "Draw, paint or photograph a tree near your school and the birds that live in it.",
} as const;

export const SEED_ARTWORK_COMPETITION = {
  id: "01938a00-0000-7000-8000-000000009301",
  code: "ORIG27",
  slug: "originals-for-animals",
  name: "Originals for Animals",
} as const;

export const SEED_SCORING_COMPETITION = {
  id: "01938a00-0000-7000-8000-000000096001",
  code: "JURY27",
  slug: "kindness-in-art",
  name: "Kindness in Art",
} as const;

export const SEED_AUCTION_COMPETITION = {
  id: "01938a00-0000-7000-8000-000000131000",
  code: "AUCT27",
  slug: "art-for-kindness",
  name: "Art for kindness",
} as const;

/**
 * The seeded competitions as of `now`. Every key date is whole days from
 * the seed day, at an IST time of day, so a date is never within a day of
 * `now` and the status each one is seeded with is the one its dates say.
 */
function seedCompetitionsAt(now: Date): readonly SeedCompetition[] {
  /** `days` days from now, as an IST datetime-local value at `time`. */
  const ist = (days: number, time: string) =>
    `${instantToIstLocal(new Date(now.getTime() + days * DAY_MS)).slice(0, 10)}T${time}`;
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);
  return [
    {
      id: "01938a00-0000-7000-8000-000000002101",
      status: "registration_open",
      slug: "neighbours-on-my-street",
      publishedAt: daysAgo(35),
      fields: {
        ...DEFAULT_FIELDS,
        ...COMMON,
        code: "NEIGH27",
        name: "Neighbours on My Street",
        theme:
          "Draw, paint or photograph an animal that shares your street, and show one kind thing you do for it.",
        participation: "both",
        disciplines: ["drawing", "painting", "photography"],
        // Open to adults on their own too (#78), so it has their group.
        ageGroups: [...AGE_GROUPS, ADULT_AGE_GROUP],
        ageCutoffDate: "2027-01-01",
        publicDisplay: true,
        keyDates: {
          registration_opens: ist(-20, "09:00"),
          registration_closes: ist(55, "23:59"),
          submissions_close: ist(80, "23:59"),
          school_round_closes: ist(90, "23:59"),
        },
      },
    },
    {
      id: SEED_ARTWORK_COMPETITION.id,
      slug: SEED_ARTWORK_COMPETITION.slug,
      status: "foa_judging",
      publishedAt: daysAgo(260),
      fields: {
        ...DEFAULT_FIELDS,
        ...COMMON,
        code: SEED_ARTWORK_COMPETITION.code,
        name: SEED_ARTWORK_COMPETITION.name,
        theme: "Draw a safe place for the animals that live beside us.",
        participation: "both",
        disciplines: ["drawing"],
        ageGroups: [...AGE_GROUPS, ADULT_AGE_GROUP],
        ageCutoffDate: "2027-01-01",
        physicalArtwork: { kind: "all_shortlisted" },
        keyDates: {
          registration_opens: ist(-220, "09:00"),
          registration_closes: ist(-130, "23:59"),
          submissions_close: ist(-60, "23:59"),
          school_round_closes: ist(-30, "23:59"),
        },
      },
    },
    {
      id: SEED_SCORING_COMPETITION.id,
      slug: SEED_SCORING_COMPETITION.slug,
      status: "foa_judging",
      publishedAt: daysAgo(250),
      fields: {
        ...DEFAULT_FIELDS,
        ...COMMON,
        code: SEED_SCORING_COMPETITION.code,
        name: SEED_SCORING_COMPETITION.name,
        theme: "Show kindness to the animals that share our neighbourhood.",
        participation: "individuals",
        disciplines: ["drawing", "videography", "essay"],
        ageGroups: [...AGE_GROUPS, ADULT_AGE_GROUP],
        ageCutoffDate: "2027-01-01",
        physicalArtwork: { kind: "not_required" },
        keyDates: {
          registration_opens: ist(-210, "09:00"),
          registration_closes: ist(-120, "23:59"),
          submissions_close: ist(-50, "23:59"),
          school_round_closes: ist(-20, "23:59"),
        },
      },
    },
    {
      ...SEED_AUCTION_COMPETITION,
      status: "foa_judging",
      publishedAt: daysAgo(230),
      fields: {
        ...DEFAULT_FIELDS,
        ...COMMON,
        code: SEED_AUCTION_COMPETITION.code,
        name: SEED_AUCTION_COMPETITION.name,
        theme: "Imagine a kind place for every animal.",
        participation: "individuals",
        disciplines: ["drawing"],
        ageGroups: [
          { label: "6–12", minAge: 6, maxAge: 12 },
          { label: "13–17", minAge: 13, maxAge: 17 },
          ADULT_AGE_GROUP,
        ],
        ageCutoffDate: "2027-01-01",
        physicalArtwork: { kind: "all_shortlisted" },
        auctionPermitted: true,
        publicDisplay: true,
        keyDates: {
          registration_opens: ist(-200, "09:00"),
          registration_closes: ist(-110, "23:59"),
          submissions_close: ist(-60, "23:59"),
          school_round_closes: ist(-30, "23:59"),
        },
      },
    },
    ...SEED_ENTRY_COMPETITIONS.map(
      ({ id, slug, ...fields }, index): SeedCompetition => ({
        id,
        slug,
        status: "registration_closed",
        publishedAt: daysAgo(24),
        fields: {
          ...DEFAULT_FIELDS,
          ...COMMON,
          ...fields,
          participation: "individuals",
          disciplines: [...fields.disciplines],
          ageGroups: [ADULT_AGE_GROUP],
          ageCutoffDate: "2027-01-01",
          keyDates: {
            registration_opens: ist(-18 + index, "09:00"),
            registration_closes: ist(-2, "23:59"),
            submissions_close: ist(120 + index, "23:59"),
          },
        },
      })
    ),
    (({ id, slug, ...fields }): SeedCompetition => ({
      id,
      slug,
      status: "registration_closed",
      publishedAt: daysAgo(40),
      fields: {
        ...DEFAULT_FIELDS,
        ...COMMON,
        ...fields,
        participation: "institutions",
        disciplines: ["drawing", "painting", "photography"],
        ageCutoffDate: "2027-01-01",
        keyDates: {
          registration_opens: ist(-35, "09:00"),
          registration_closes: ist(-3, "23:59"),
          submissions_close: ist(60, "23:59"),
          school_round_closes: ist(75, "23:59"),
        },
      },
    }))(SEED_SCHOOL_SUBMISSIONS_COMPETITION),
    {
      id: "01938a00-0000-7000-8000-000000002102",
      status: "published",
      slug: "a-bowl-of-water",
      publishedAt: daysAgo(10),
      fields: {
        ...DEFAULT_FIELDS,
        ...COMMON,
        code: "WATER27",
        name: "A Bowl of Water",
        theme:
          "Summer is coming. Show how a bowl of clean water in the shade helps the birds and animals near you.",
        participation: "individuals",
        disciplines: ["drawing", "essay"],
        ageCutoffDate: "2027-04-01",
        physicalArtwork: { kind: "not_required" },
        keyDates: {
          registration_opens: ist(70, "09:00"),
          registration_closes: ist(128, "23:59"),
          submissions_close: ist(153, "23:59"),
        },
      },
    },
    {
      id: "01938a00-0000-7000-8000-000000002103",
      // Its submissions have closed, and the judging seed publishes every
      // rubric it needs (#88), so its school round is under way.
      status: "school_judging",
      slug: "kinder-skies",
      publishedAt: daysAgo(200),
      fields: {
        ...DEFAULT_FIELDS,
        ...COMMON,
        code: "SKIES26",
        name: "Kinder Skies",
        theme:
          "Kites and birds share the sky. Make a picture or a craft that shows how both can fly safely.",
        participation: "institutions",
        disciplines: ["drawing", "painting", "craft"],
        ageCutoffDate: "2026-08-01",
        // Every participant submitted digitally, so its school round (#89)
        // has entries to shortlist.
        digitalScope: "all_participants",
        physicalArtwork: { kind: "top_n", count: 3 },
        publicDisplay: true,
        auctionPermitted: true,
        keyDates: {
          registration_opens: ist(-170, "09:00"),
          registration_closes: ist(-95, "23:59"),
          submissions_close: ist(-50, "23:59"),
          // The school's seeded round is still open for its coordinator;
          // #90 makes rounds overdue at this deadline.
          school_round_closes: ist(10, "23:59"),
        },
      },
    },
    {
      // Half written, so the admin preview has gaps to list.
      id: SEED_SCOPES.competition.id,
      status: "draft",
      slug: "seed-drawing-competition",
      publishedAt: null,
      fields: {
        ...DEFAULT_FIELDS,
        code: "DRAW27",
        name: SEED_SCOPES.competition.name,
        theme: "The animal you would most like to thank, and why.",
        participation: "both",
        disciplines: ["drawing"],
        ageGroups: AGE_GROUPS,
        keyDates: { registration_opens: ist(190, "09:00") },
      },
    },
  ];
}

/**
 * Inserts a competition with its age groups, categories and key dates,
 * unless one with its id, code or slug is there already, and the status
 * jobs for its dates still ahead. Seed data: no audit entry, no creating
 * user.
 */
export async function insertCompetition(
  { db, clock }: DbWithClock,
  seed: SeedCompetition
): Promise<boolean> {
  const parsed = parseFields(seed.fields);
  if (!parsed.ok)
    throw new Error(`Seed competition ${seed.id}: ${parsed.error}`);
  const now = clock.now();
  const [inserted] = await db
    .insert(competition)
    .values({
      id: seed.id,
      slug: seed.slug,
      ...columnsOf(parsed.values),
      status: seed.status,
      publishedAt: seed.publishedAt,
      cancelledAt: seed.cancelled?.at ?? null,
      cancelReason: seed.cancelled?.reason ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: competition.id });
  if (!inserted) return false;
  await replaceAgeGroups(db, seed.id, parsed.values, now);
  await replaceKeyDates(db, seed.id, parsed.values.keyDates);
  // The jobs that move its status on from here (#71), as publishing saves
  // them; a date already passed needs none, as the status agrees with it.
  await saveStatusJobs(
    db,
    clock,
    seed.id,
    statusJobs(seed.status, parsed.values.keyDates).filter(
      (job) => job.dueAt.getTime() > now.getTime()
    )
  );
  return true;
}

/** The competitions above and their managers. Running again changes nothing. */
export async function seedCompetitions(deps: SeedDeps): Promise<void> {
  for (const account of SEED_COMPETITION_MANAGERS) {
    const manager = await ensureVerifiedAccount(deps, account);
    await ensureGrant(deps, manager.id, {
      role: "competition_manager",
      scope: { type: "global" },
    });
    await ensureSeedAuthenticator(deps, manager.id);
  }
  for (const seed of seedCompetitionsAt(deps.clock.now())) {
    await insertCompetition(deps, seed);
  }
}

export type SeedCompetitionOptions = {
  /** Draft unless given; a published one is stamped with the clock. */
  status?: Exclude<CompetitionStatus, "cancelled">;
} & Partial<CompetitionFields>;

/**
 * The `h.seed.competition()` builder: a complete competition (publishable
 * as it is) with its own code and slug, and any fields given.
 */
export function competitionBuilder(deps: DbWithClock) {
  let made = 0;
  return async ({
    status = "draft",
    ...fields
  }: SeedCompetitionOptions = {}) => {
    made += 1;
    const letters =
      String.fromCharCode(65 + (Math.floor((made - 1) / 26) % 26)) +
      String.fromCharCode(65 + ((made - 1) % 26));
    const name = fields.name ?? `Seed competition ${made}`;
    const code = fields.code ?? `CMP${letters}27`;
    const now = deps.clock.now();
    const seed: SeedCompetition = {
      id: uuidv7(now),
      status,
      slug: competitionSlugCandidates(name, code)[0]!,
      publishedAt: status === "draft" ? null : now,
      fields: {
        ...seedCompetitionsAt(now)[0]!.fields,
        ...fields,
        name,
        code,
      },
    };
    if (!(await insertCompetition(deps, seed))) {
      throw new Error(`A competition with code ${code} or its slug exists`);
    }
    return { id: seed.id, code, slug: seed.slug, status };
  };
}
