import { and, desc, eq, inArray } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import {
  consentEvent,
  consentForm,
  institutionRegistration,
  participantProfile,
  registration,
} from "../../db/schema";
import {
  offeredPurposes,
  publicationPurposeFor,
  type CompetitionConsentSetup,
  type PublicUse,
} from "./domain/guardian-purposes";
import { resolvePublicCredit, type CreditPerson } from "./domain/public-credit";
import {
  decideSchoolRouteUse,
  isPublicPurpose,
  type CurrentConsent,
  type PublicPurpose,
  type UseDecision,
} from "./domain/public-use";
import { subjectEvents } from "./repository";

type Target = { profileId: string; competitionId: string };

/** Participation and judging on the school route, for callers with an enrolled subject. */
export async function schoolParticipationUse(
  { db }: { db: AppDb },
  input: Target & { use: "participation" | "judging" }
): Promise<UseDecision> {
  const { profileId, competitionId, use } = input;
  const [entry] = await db
    .select({ declaredAt: institutionRegistration.participationDeclaredAt })
    .from(registration)
    .innerJoin(
      institutionRegistration,
      eq(institutionRegistration.id, registration.institutionRegistrationId)
    )
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, registration.participantProfileId)
    )
    .where(
      and(
        eq(registration.participantProfileId, profileId),
        eq(registration.competitionId, competitionId),
        eq(registration.route, "institution"),
        inArray(registration.status, ["enrolled", "confirmed"]),
        eq(institutionRegistration.competitionId, competitionId),
        eq(institutionRegistration.status, "active"),
        eq(participantProfile.ownerKind, "institution"),
        eq(
          participantProfile.managingInstitutionId,
          institutionRegistration.institutionId
        )
      )
    );
  if (!entry) return { allowed: false, reason: "no_declaration" };
  const [latest] = await subjectEvents(
    db,
    { type: "participant_profile", id: profileId },
    "participation",
    competitionId
  );
  return decideSchoolRouteUse({
    use,
    institutionDeclared: entry.declaredAt !== null,
    consent:
      latest?.method === "web_form"
        ? { status: latest.action, method: latest.method }
        : { status: "never" },
  });
}

type PublicConsentState = {
  purpose: PublicPurpose;
  status: "given" | "withdrawn" | "not_granted";
};

/** Resolve current evidence for the offered purposes of scoped school-route students. */
export async function schoolPublicConsents(
  db: AppDb,
  {
    profileIds,
    competitionId,
    offers,
  }: {
    profileIds: readonly string[];
    competitionId: string;
    offers: readonly { purpose: PublicPurpose; id: string }[];
  }
): Promise<Map<string, PublicConsentState[]>> {
  if (profileIds.length === 0 || offers.length === 0) return new Map();
  const events = await db
    .selectDistinctOn([consentEvent.subjectId, consentEvent.purpose], {
      profileId: consentEvent.subjectId,
      purpose: consentEvent.purpose,
      action: consentEvent.action,
      method: consentEvent.method,
      documentId: consentEvent.documentId,
      formStatus: consentForm.status,
      formUses: consentForm.uses,
      formDocuments: consentForm.documents,
    })
    .from(consentEvent)
    .leftJoin(
      consentForm,
      and(
        eq(consentForm.id, consentEvent.consentFormId),
        eq(consentForm.participantProfileId, consentEvent.subjectId),
        eq(consentForm.competitionId, consentEvent.competitionId),
        eq(consentForm.reviewedByUserId, consentEvent.reviewerUserId)
      )
    )
    .where(
      and(
        eq(consentEvent.subjectType, "participant_profile"),
        inArray(consentEvent.subjectId, profileIds),
        eq(consentEvent.competitionId, competitionId),
        inArray(
          consentEvent.purpose,
          offers.map(({ purpose }) => purpose)
        )
      )
    )
    .orderBy(
      consentEvent.subjectId,
      consentEvent.purpose,
      desc(consentEvent.id)
    );

  const latestByPurpose = new Map(
    events.map((event) => [`${event.profileId}/${event.purpose}`, event])
  );
  return new Map(
    profileIds.map((profileId) => [
      profileId,
      offers.map(({ purpose, id }): PublicConsentState => {
        const latest = latestByPurpose.get(`${profileId}/${purpose}`);
        const consent: CurrentConsent =
          !latest ||
          latest.documentId !== id ||
          (latest.method === "paper_form" &&
            (latest.formStatus !== "accepted" ||
              !latest.formUses?.includes(purpose) ||
              latest.formDocuments?.[purpose]?.documentId !== id))
            ? { status: "never" }
            : { status: latest.action, method: latest.method };
        const decision = decideSchoolRouteUse({
          use: purpose,
          institutionDeclared: false,
          consent,
        });
        const status = decision.allowed
          ? "given"
          : decision.reason === "withdrawn"
            ? "withdrawn"
            : "not_granted";
        return { purpose, status };
      }),
    ])
  );
}

/** Public credit from current evidence, using the same field limits as #82. */
export async function schoolPublicCredit(
  db: AppDb,
  {
    profileId,
    competitionId,
    use,
    setup,
    person,
  }: Target & {
    use: PublicUse;
    setup: CompetitionConsentSetup;
    person: CreditPerson;
  }
) {
  const purposes: PublicPurpose[] = [
    publicationPurposeFor(use),
    "display_school",
    "display_city",
  ];
  const offers = offeredPurposes(setup).flatMap(({ purpose, document }) =>
    isPublicPurpose(purpose) && purposes.includes(purpose)
      ? [{ purpose, id: document.id }]
      : []
  );
  const consents = await schoolPublicConsents(db, {
    profileIds: [profileId],
    competitionId,
    offers,
  });
  const given = new Set(
    consents
      .get(profileId)
      ?.filter(({ status }) => status === "given")
      .map(({ purpose }) => purpose)
  );
  return resolvePublicCredit(person, use, given);
}
