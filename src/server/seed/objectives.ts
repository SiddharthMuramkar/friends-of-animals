// Historical synthetic source records for the leadership report. The separate
// sample keeps the active competition, survey and ambassador journeys intact.
// Milestones derive from actual published results, membership and approval;
// social observations are the only manually entered aggregate facts.
import { and, eq } from "drizzle-orm";
import {
  ambassadorApplication,
  communityMember,
  competition,
  competitionAgeGroup,
  competitionCategory,
  consentEvent,
  engagementMilestone,
  entry,
  entryFile,
  institution,
  institutionRegistration,
  judgingRound,
  participantProfile,
  registration,
  resultAward,
  resultRelease,
  roundEntry,
  roundResult,
  schoolRound,
  schoolRoundPick,
  socialSnapshot,
  survey,
  surveyInvitation,
  user,
  type ResultAward,
} from "../db/schema";
import { instantToIstLocal } from "../modules/competitions/domain/ist";
import { DEFAULT_FIELDS } from "../modules/competitions/fields";
import { communityMemberFor, recordEngagement } from "../modules/community";
import { recordPublishedEngagement } from "../modules/community/results";
import { COMMUNITY_MEMBER_PURPOSE } from "../modules/community/profile-fields";
import { ambassadorEligibility } from "../modules/community/ambassadors/domain/eligibility";
import { latestDocument } from "../modules/consent/repository";
import { TIE_BREAK_RULE } from "../modules/judging/domain/ranking";
import { istDateOf } from "../modules/ledger/domain/period";
import { ageAt } from "../modules/participants/domain/age";
import { parseIsoDate } from "../modules/registration/domain/calendar-date";
import { PROFILE_PURPOSE } from "../modules/registration/student-profile";
import {
  publishResultsRelease,
  snapshotHash,
} from "../modules/results/releases";
import { JUDGING_STATEMENT_VERSION } from "../modules/school-round/domain/judging-statement";
import { readSetting } from "../modules/settings/read";
import { surveyAudience } from "../modules/surveys/audience";
import { surveyToken } from "../modules/surveys/token";
import { essayBodyFromText, essayBodyText } from "../rich-text/essay";
import { insertCompetition, SEED_COMPETITION_MANAGERS } from "./competitions";
import { SEED_INSTITUTIONS } from "./institutions";
import { SEED_STUDENTS } from "./registration";
import { SEED_REPORT_PARTICIPANT } from "./reports";
import type { Seeder } from "./types";

const id = (n: number) =>
  `01938a00-0000-7000-8000-000000135${String(n).padStart(3, "0")}`;
const DAY = 86_400_000;
const worker = { kind: "system", process: "worker" } as const;
const seed = { kind: "system", process: "seed" } as const;
export const SEED_OBJECTIVES = {
  code: "KIND27",
  name: "Kindness in Action",
  slug: "kindness-in-action",
  competitionId: id(1),
  surveyId: id(21),
  ambassadorId: id(25),
} as const;

export const seedObjectives: Seeder = async (deps) => {
  const { db, clock, cipher, blindIndex } = deps;
  const now = clock.now();
  const day = (n: number) => new Date(+now + n * DAY);
  const date = (n: number) => istDateOf(day(n));
  const observations = [
    {
      id: id(31),
      channel: "instagram",
      recordedFor: date(-90),
      followers: 120,
      posts: 5,
      reach: 420,
      impressions: 650,
      engagements: 52,
    },
    {
      id: id(32),
      channel: "instagram",
      recordedFor: date(-60),
      followers: 195,
      posts: 6,
      reach: 870,
      impressions: 1300,
      engagements: 101,
    },
    {
      id: id(33),
      channel: "instagram",
      recordedFor: date(-30),
      followers: 240,
      posts: 8,
      reach: 1100,
      impressions: 1500,
      engagements: 120,
    },
    {
      id: id(34),
      channel: "youtube",
      recordedFor: date(-60),
      followers: 30,
      posts: 2,
      reach: null,
      impressions: 100,
      engagements: 5,
    },
    {
      id: id(35),
      channel: "youtube",
      recordedFor: date(-30),
      followers: 39,
      posts: 3,
      reach: null,
      impressions: 170,
      engagements: 11,
    },
  ] as const;
  await db
    .insert(socialSnapshot)
    .values(
      observations.map((row) => ({ ...row, createdAt: now, updatedAt: now }))
    )
    .onConflictDoNothing();

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: competition.id })
      .from(competition)
      .where(eq(competition.id, SEED_OBJECTIVES.competitionId));
    // Do not rebuild records that a preview user changed or erased.
    if (existing) return;
    const [adult] = await tx
      .select({
        id: user.id,
        profileId: participantProfile.id,
        dob: participantProfile.dobCiphertext,
      })
      .from(user)
      .innerJoin(
        participantProfile,
        eq(participantProfile.ownerUserId, user.id)
      )
      .where(
        and(
          eq(user.id, SEED_REPORT_PARTICIPANT.id),
          eq(user.email, SEED_REPORT_PARTICIPANT.email),
          eq(participantProfile.ownerKind, "self")
        )
      );
    const [school] = await tx
      .select({ id: institution.id })
      .from(institution)
      .where(
        and(
          eq(institution.id, SEED_INSTITUTIONS.verified.id),
          eq(institution.name, SEED_INSTITUTIONS.verified.name),
          eq(institution.status, "verified")
        )
      );
    const [pupil] = await tx
      .select({ id: participantProfile.id })
      .from(participantProfile)
      .where(
        and(
          eq(participantProfile.id, SEED_STUDENTS[0]!.profileId),
          eq(
            participantProfile.managingInstitutionId,
            SEED_INSTITUTIONS.verified.id
          ),
          eq(participantProfile.fullName, SEED_STUDENTS[0]!.fullName)
        )
      );
    // This owns only the exact demo accounts and sample institution.
    if (!adult || !school || !pupil) return;
    const local = (n: number) => instantToIstLocal(day(n));
    const { competitionId, code, slug, name } = SEED_OBJECTIVES;
    const created = await insertCompetition(
      { db: tx, clock },
      {
        id: competitionId,
        slug,
        status: "foa_judging",
        publishedAt: day(-310),
        fields: {
          ...DEFAULT_FIELDS,
          code,
          name,
          theme: "Small acts of kindness for local animals",
          welfareMessage: "Every kind action makes a difference.",
          rules:
            "Submit an original essay about helping neighbourhood animals.",
          permittedMaterials: "Typed essay",
          duration: "A completed pilot",
          participation: "both",
          disciplines: ["essay"],
          digitalScope: "all_participants",
          ageGroups: [
            { label: "Children", minAge: 6, maxAge: 17 },
            { label: "Adults", minAge: 18, maxAge: 99 },
          ],
          ageCutoffDate: "2027-01-01",
          physicalArtwork: { kind: "not_required" },
          keyDates: {
            registration_opens: local(-300),
            registration_closes: local(-115),
            submissions_close: local(-110),
            school_round_closes: local(-105),
          },
        },
      }
    );
    if (!created) return;
    const groups = await tx
      .select()
      .from(competitionAgeGroup)
      .where(eq(competitionAgeGroup.competitionId, competitionId));
    const kids = groups.find((g) => g.label === "Children")!;
    const adults = groups.find((g) => g.label === "Adults")!;
    const [category] = await tx
      .select()
      .from(competitionCategory)
      .where(
        and(
          eq(competitionCategory.competitionId, competitionId),
          eq(competitionCategory.ageGroupId, kids.id)
        )
      );
    if (!category) throw Error("Sample report category missing");
    await tx.insert(institutionRegistration).values({
      id: id(2),
      institutionId: school.id,
      competitionId,
      reference: "KIND27-I-5EED1",
      createdAt: day(-140),
      updatedAt: day(-140),
    });
    await tx.insert(registration).values([
      {
        id: id(3),
        participantProfileId: pupil.id,
        competitionId,
        route: "institution",
        institutionRegistrationId: id(2),
        ageGroupId: kids.id,
        status: "confirmed",
        registrationNumber: "KIND27-R-5EED01",
        createdAt: day(-130),
        updatedAt: day(-120),
      },
      {
        id: id(4),
        participantProfileId: adult.profileId,
        competitionId,
        route: "individual",
        ageGroupId: adults.id,
        status: "confirmed",
        registrationNumber: "KIND27-R-5EED02",
        createdAt: day(-130),
        updatedAt: day(-120),
      },
    ]);
    const body = essayBodyFromText(
      "A bowl of clean water in a shaded place helps the animals on our street. We can wash it each morning and ask our neighbours to help care for it."
    );
    for (const [index, person] of [
      { id: pupil.id, registrationId: id(3) },
      { id: adult.profileId, registrationId: id(4) },
    ].entries()) {
      const entryId = id(5 + index);
      await tx.insert(entry).values({
        id: entryId,
        code: `KIND27-E-5EED0${index + 1}`,
        competitionId,
        registrationId: person.registrationId,
        participantProfileId: person.id,
        discipline: "essay",
        title: "A bowl of fresh water",
        description: "Sample essay from the completed pilot.",
        status: "foa_verified",
        submittedAt: day(-112),
        createdAt: day(-112),
        updatedAt: day(-104),
      });
      await tx.insert(entryFile).values({
        id: id(7 + index),
        entryId,
        attemptNumber: 1,
        kind: "text",
        essayBody: body,
        wordCount: essayBodyText(body).split(/\s+/).length,
        status: "live",
        uploadCompletedAt: day(-112),
        becameLiveAt: day(-112),
        createdAt: day(-112),
        updatedAt: day(-112),
      });
    }
    await tx.insert(schoolRound).values({
      id: id(9),
      competitionId,
      institutionRegistrationId: id(2),
      status: "finalised",
      openedAt: day(-110),
      finalisedAt: day(-106),
      judgingAttestedAt: day(-106),
      judgingStatementVersion: JUDGING_STATEMENT_VERSION,
      createdAt: day(-110),
      updatedAt: day(-106),
    });
    await tx.insert(schoolRoundPick).values({
      entryId: id(5),
      roundId: id(9),
      categoryId: category.id,
      position: 1,
      pickedAt: day(-107),
    });
    await tx.insert(judgingRound).values({
      id: id(10),
      competitionId,
      name: "Completed pilot final",
      nameKey: "completed pilot final",
      status: "open",
      judgesPhysical: false,
      openedAt: day(-104),
      createdAt: day(-104),
      updatedAt: day(-103),
    });
    await tx.insert(roundEntry).values([
      { roundId: id(10), entryId: id(5), admittedAt: day(-104) },
      { roundId: id(10), entryId: id(6), admittedAt: day(-104) },
    ]);
    // Adult's actual finalist award is the source of the ambassador rung;
    // the pupil was a school winner, but did not earn national recognition.
    await tx.insert(roundResult).values([
      {
        roundId: id(10),
        entryId: id(5),
        code: "KIND27-E-5EED01",
        discipline: "essay",
        categoryId: kids.id,
        rank: 1,
        scoreNumerator: "62",
        scoreDenominator: "1",
        sheetsCounted: 2,
        outcome: "none",
      },
      {
        roundId: id(10),
        entryId: id(6),
        code: "KIND27-E-5EED02",
        discipline: "essay",
        categoryId: adults.id,
        rank: 1,
        scoreNumerator: "90",
        scoreDenominator: "1",
        sheetsCounted: 2,
        outcome: "finalist",
      },
    ]);
    await tx
      .update(judgingRound)
      .set({
        status: "locked",
        lockedAt: day(-103),
        tieBreakRule: TIE_BREAK_RULE,
      })
      .where(eq(judgingRound.id, id(10)));
    const releaseId = id(11);
    const release = {
      id: releaseId,
      competitionId,
      sourceRoundId: id(10),
      preparedAt: day(-102),
      preparedByUserId: SEED_COMPETITION_MANAGERS[0].id,
      publishAt: day(-100),
      deliveryNote: "Completed synthetic pilot.",
    };
    const award: ResultAward = {
      releaseId,
      entryId: id(6),
      discipline: "essay",
      categoryId: adults.id,
      categoryLabel: adults.label,
      outcome: "finalist",
      awardPosition: null,
      awardBand: null,
      prize: null,
      suitableForAuction: false,
    };
    await tx.insert(resultRelease).values({
      ...release,
      status: "pending_approval",
      contentHash: snapshotHash(release, [award]),
    });
    await tx.insert(resultAward).values(award);
    await tx
      .update(resultRelease)
      .set({
        status: "approved",
        approvedAt: day(-101),
        approvedByUserId: SEED_COMPETITION_MANAGERS[1].id,
      })
      .where(eq(resultRelease.id, releaseId));
    const published = await publishResultsRelease(
      { db: tx, clock: { now: () => day(-100) }, actor: worker },
      { competitionId, releaseId }
    );
    if (!published.ok || published.outcome !== "published")
      throw Error("Objective seed result publication failed");
    await recordPublishedEngagement(
      { db: tx, clock, actor: worker },
      { competitionId, releaseId, publishedAt: day(-100).toISOString() }
    );

    const doc = await latestDocument(tx, "messages");
    if (doc) {
      const [existingConsent] = await tx
        .select({ id: consentEvent.id })
        .from(consentEvent)
        .where(
          and(
            eq(consentEvent.subjectId, adult.id),
            eq(consentEvent.subjectType, "user"),
            eq(consentEvent.purpose, "messages")
          )
        )
        .limit(1);
      if (!existingConsent)
        await tx.insert(consentEvent).values({
          id: id(20),
          subjectType: "user",
          subjectId: adult.id,
          giverUserId: adult.id,
          purpose: "messages",
          documentId: doc.id,
          action: "given",
          method: "web_form",
          occurredAt: day(-100),
        });
      const audience = await surveyAudience(
        { db: tx, cipher, clock: { now: () => day(-99) } },
        competitionId
      );
      // Seed only the consented synthetic adult as respondent; no new
      // invitation is sent from the historical data.
      if (audience.includes(adult.id)) {
        await tx.insert(survey).values({
          id: SEED_OBJECTIVES.surveyId,
          competitionId,
          title: "Completed pilot feedback",
          questions: [
            { text: "Would you take part again?", choices: ["Yes", "No"] },
            {
              text: "How useful was the activity?",
              choices: ["Very useful", "Somewhat useful", "Not useful"],
            },
          ],
          createdAt: day(-99),
          updatedAt: day(-69),
          sentAt: day(-99),
          closesAt: day(-69),
          closedAt: day(-69),
        });
        await tx.insert(surveyInvitation).values({
          id: id(22),
          surveyId: SEED_OBJECTIVES.surveyId,
          userId: adult.id,
          tokenHash: surveyToken(blindIndex, id(22)).tokenHash,
          status: "sent",
          createdAt: day(-99),
          answers: [0, 0],
          answeredAt: day(-95),
        });
      }
    }
    const subject = { kind: "user", userId: adult.id } as const;
    if (!(await communityMemberFor(tx, subject))) {
      const membershipId = id(23);
      const [member] = await tx
        .insert(communityMember)
        .values({
          id: membershipId,
          subjectUserId: adult.id,
          joinedByUserId: adult.id,
          status: "active",
          displayNameCiphertext: cipher.encrypt(
            COMMUNITY_MEMBER_PURPOSE.displayName,
            SEED_REPORT_PARTICIPANT.name
          ),
          joinedAt: day(-150),
          createdAt: day(-150),
          updatedAt: day(-150),
        })
        .returning();
      await recordEngagement(
        tx,
        { clock, actor: seed },
        {
          type: "milestone",
          kind: "community_member",
          subject,
          competitionId: null,
          sourceType: "community_member",
          sourceId: membershipId,
          occurredAt: member!.joinedAt,
        }
      );
      const milestones = await tx
        .select({ kind: engagementMilestone.kind })
        .from(engagementMilestone)
        .where(eq(engagementMilestone.subjectProfileId, adult.profileId));
      const dob = parseIsoDate(cipher.decrypt(PROFILE_PURPOSE.dob, adult.dob));
      const eligible = ambassadorEligibility(
        {
          membership: member!,
          ageYears: dob ? ageAt(dob, day(-5)) : null,
          milestones: milestones.map((m) => m.kind),
          hasOpenApplication: true,
        },
        {
          membershipDays: await readSetting(
            tx,
            "ambassadors.minMembershipDays"
          ),
          ageYears: await readSetting(tx, "ambassadors.minAgeYears"),
          qualifyingMilestones: await readSetting(
            tx,
            "ambassadors.qualifyingMilestones"
          ),
        },
        day(-5),
        "approve"
      );
      if (eligible.eligible) {
        await tx.insert(ambassadorApplication).values({
          id: SEED_OBJECTIVES.ambassadorId,
          applicantUserId: adult.id,
          submittedAt: day(-7),
          decidedAt: day(-5),
          status: "approved",
        });
        await recordEngagement(
          tx,
          { clock, actor: seed },
          {
            type: "milestone",
            kind: "ambassador",
            subject,
            competitionId: null,
            sourceType: "ambassador_application",
            sourceId: SEED_OBJECTIVES.ambassadorId,
            occurredAt: day(-5),
          }
        );
      }
    }
  });
};
