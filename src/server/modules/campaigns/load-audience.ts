// Reads everyone a segment could hold (#126), with what each criterion
// matches them on and the consent that decides them, for the pure planner
// (./domain/audience.ts). Read-only; preview, send and the counts all plan
// through here, so the numbers a community manager sees are the people the
// send queues.
//
// Candidates come from two sources:
//
//   - accounts: every user but a child's own login. Their roles are their
//     grants; their competitions, their own registrations and those of the
//     institutions they look after; their cities, their own profile's and
//     those institutions';
//   - children: every guardian-kept participant profile, with its own
//     registrations and city, and the guardians who look after it now.
//
// A school's student without an account has no consent to messages on the
// platform, so is never a candidate. (#119 adds community members here, as
// a criterion over accounts; see ./domain/segment.ts.)
//
// The whole roster is read in a few queries and planned in memory: right
// for FOA's thousands of accounts; page it if that grows by orders of
// magnitude.
//
// Loads under plain Node (the worker): relative imports only.

import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  notInArray,
} from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import {
  consentEvent,
  engagementMilestone,
  guardian,
  guardianLink,
  institution,
  institutionRegistration,
  participantProfile,
  registration,
  user,
  userRole,
} from "../../db/schema";
import type { AudienceCandidate, ConsentStatus } from "./domain/audience";
import { SEGMENT_ROLES, type SegmentAttributes } from "./domain/segment";

/** Registrations that no longer take part. */
const ENDED_REGISTRATIONS = ["withdrawn", "refunded", "cancelled"] as const;

/** The roles that look after an institution, for its competitions and city. */
const INSTITUTION_ROLES = [
  "institution_admin",
  "institution_coordinator",
] as const;

type Attributes = { [K in keyof Required<SegmentAttributes>]: Set<string> };

function attributes(): Attributes {
  return {
    roles: new Set(),
    competitionIds: new Set(),
    cities: new Set(),
    milestones: new Set(),
  };
}

function frozen(found: Attributes | undefined): SegmentAttributes {
  return {
    roles: [...(found?.roles ?? [])],
    competitionIds: [...(found?.competitionIds ?? [])],
    cities: [...(found?.cities ?? [])],
    ...(found?.milestones.size ? { milestones: [...found.milestones] } : {}),
  };
}

function add(
  map: Map<string, Attributes>,
  key: string,
  criterion: keyof SegmentAttributes,
  value: string | null
) {
  if (value === null || value.trim() === "") return;
  const found = map.get(key) ?? attributes();
  found[criterion].add(value);
  map.set(key, found);
}

/**
 * The latest consent event per subject for `purpose`, with its giver. A
 * user's log is ordered by time, a child's by id (the consent module's
 * rule, ../consent/domain/consent-state.ts).
 */
export async function latestConsents(
  db: AppDb,
  subjectType: "user" | "participant_profile",
  purpose: "messages" | "communications",
  subjectIds?: readonly string[]
): Promise<Map<string, ConsentStatus>> {
  if (subjectIds?.length === 0) return new Map();
  const order =
    subjectType === "user"
      ? [desc(consentEvent.occurredAt), desc(consentEvent.id)]
      : [desc(consentEvent.id)];
  const rows = await db
    .selectDistinctOn([consentEvent.subjectId], {
      subjectId: consentEvent.subjectId,
      action: consentEvent.action,
      giverUserId: consentEvent.giverUserId,
    })
    .from(consentEvent)
    .where(
      and(
        eq(consentEvent.subjectType, subjectType),
        eq(consentEvent.purpose, purpose),
        isNull(consentEvent.competitionId),
        subjectIds
          ? inArray(consentEvent.subjectId, [...subjectIds])
          : undefined
      )
    )
    .orderBy(consentEvent.subjectId, ...order);
  return new Map(
    rows.map((row) => [
      row.subjectId,
      { status: row.action, giverUserId: row.giverUserId },
    ])
  );
}

/** Users whose guardian link to each child is live and verified. */
export async function activeGuardians(
  db: AppDb,
  profileIds?: readonly string[]
): Promise<Map<string, string[]>> {
  if (profileIds?.length === 0) return new Map();
  const rows = await db
    .select({
      profileId: guardianLink.participantProfileId,
      userId: guardian.userId,
    })
    .from(guardianLink)
    .innerJoin(guardian, eq(guardian.id, guardianLink.guardianId))
    .where(
      and(
        isNull(guardianLink.revokedAt),
        isNotNull(guardian.verifiedAt),
        profileIds
          ? inArray(guardianLink.participantProfileId, [...profileIds])
          : undefined
      )
    );
  const byProfile = new Map<string, string[]>();
  for (const { profileId, userId } of rows) {
    byProfile.set(profileId, [...(byProfile.get(profileId) ?? []), userId]);
  }
  return byProfile;
}

/** Everyone a segment could hold, in a stable order. */
export async function loadCandidates(db: AppDb): Promise<AudienceCandidate[]> {
  const [
    accounts,
    roles,
    profiles,
    registrations,
    institutionStaff,
    institutionCompetitions,
    messages,
    communications,
    guardians,
    milestones,
  ] = await Promise.all([
    db.select({ id: user.id }).from(user).orderBy(user.id),
    db
      .select({
        userId: userRole.userId,
        role: userRole.role,
        scopeType: userRole.scopeType,
        scopeId: userRole.scopeId,
      })
      .from(userRole)
      .where(inArray(userRole.role, [...SEGMENT_ROLES, ...INSTITUTION_ROLES])),
    db
      .select({
        id: participantProfile.id,
        ownerKind: participantProfile.ownerKind,
        ownerUserId: participantProfile.ownerUserId,
        loginUserId: participantProfile.loginUserId,
        city: participantProfile.city,
      })
      .from(participantProfile)
      .where(inArray(participantProfile.ownerKind, ["self", "guardian"]))
      .orderBy(participantProfile.id),
    db
      .select({
        profileId: registration.participantProfileId,
        competitionId: registration.competitionId,
      })
      .from(registration)
      .innerJoin(
        participantProfile,
        eq(participantProfile.id, registration.participantProfileId)
      )
      .where(
        and(
          inArray(participantProfile.ownerKind, ["self", "guardian"]),
          notInArray(registration.status, [...ENDED_REGISTRATIONS])
        )
      ),
    db.select({ id: institution.id, city: institution.city }).from(institution),
    db
      .select({
        institutionId: institutionRegistration.institutionId,
        competitionId: institutionRegistration.competitionId,
      })
      .from(institutionRegistration)
      .where(eq(institutionRegistration.status, "active")),
    latestConsents(db, "user", "messages"),
    latestConsents(db, "participant_profile", "communications"),
    activeGuardians(db),
    db
      .select({
        userId: engagementMilestone.subjectUserId,
        profileId: engagementMilestone.subjectProfileId,
        kind: engagementMilestone.kind,
      })
      .from(engagementMilestone),
  ]);

  const competitionsByProfile = new Map<string, string[]>();
  for (const { profileId, competitionId } of registrations) {
    competitionsByProfile.set(profileId, [
      ...(competitionsByProfile.get(profileId) ?? []),
      competitionId,
    ]);
  }
  const cityOfInstitution = new Map(
    institutionStaff.map(({ id, city }) => [id, city])
  );
  const competitionsOfInstitution = new Map<string, string[]>();
  for (const { institutionId, competitionId } of institutionCompetitions) {
    competitionsOfInstitution.set(institutionId, [
      ...(competitionsOfInstitution.get(institutionId) ?? []),
      competitionId,
    ]);
  }

  const ofUser = new Map<string, Attributes>();
  const ofChild = new Map<string, Attributes>();
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const childByLogin = new Map(
    profiles
      .filter(
        (profile) =>
          profile.ownerKind === "guardian" && profile.loginUserId !== null
      )
      .map((profile) => [profile.loginUserId!, profile.id])
  );
  for (const milestone of milestones) {
    if (milestone.userId !== null) {
      const childId = childByLogin.get(milestone.userId);
      if (childId) add(ofChild, childId, "milestones", milestone.kind);
      else add(ofUser, milestone.userId, "milestones", milestone.kind);
    } else if (milestone.profileId !== null) {
      const profile = profileById.get(milestone.profileId);
      if (profile?.ownerKind === "guardian")
        add(ofChild, profile.id, "milestones", milestone.kind);
      else if (profile?.ownerKind === "self" && profile.ownerUserId)
        add(ofUser, profile.ownerUserId, "milestones", milestone.kind);
    }
  }
  for (const grant of roles) {
    if ((SEGMENT_ROLES as readonly string[]).includes(grant.role)) {
      add(ofUser, grant.userId, "roles", grant.role);
    }
    if (
      grant.scopeType === "institution" &&
      grant.scopeId !== null &&
      (INSTITUTION_ROLES as readonly string[]).includes(grant.role)
    ) {
      add(
        ofUser,
        grant.userId,
        "cities",
        cityOfInstitution.get(grant.scopeId) ?? null
      );
      for (const competitionId of competitionsOfInstitution.get(
        grant.scopeId
      ) ?? []) {
        add(ofUser, grant.userId, "competitionIds", competitionId);
      }
    }
  }

  const childLogins = new Set<string>();
  const children: Extract<AudienceCandidate, { kind: "child" }>[] = [];
  for (const profile of profiles) {
    const competitions = competitionsByProfile.get(profile.id) ?? [];
    if (profile.ownerKind === "self") {
      if (profile.ownerUserId === null) continue;
      add(ofUser, profile.ownerUserId, "cities", profile.city);
      for (const competitionId of competitions) {
        add(ofUser, profile.ownerUserId, "competitionIds", competitionId);
      }
      continue;
    }
    add(ofChild, profile.id, "cities", profile.city);
    for (const competitionId of competitions) {
      add(ofChild, profile.id, "competitionIds", competitionId);
    }
    if (profile.loginUserId !== null) childLogins.add(profile.loginUserId);
    children.push({
      kind: "child",
      profileId: profile.id,
      loginUserId: profile.loginUserId,
      attributes: frozen(ofChild.get(profile.id)),
      communicationsConsent: communications.get(profile.id) ?? {
        status: "never",
      },
      activeGuardianUserIds: guardians.get(profile.id) ?? [],
    });
  }

  const adults: AudienceCandidate[] = accounts
    .filter(({ id }) => !childLogins.has(id))
    .map(({ id }) => ({
      kind: "adult",
      userId: id,
      attributes: frozen(ofUser.get(id)),
      messagesConsent: messages.get(id) ?? { status: "never" },
    }));
  return [...adults, ...children];
}
