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
  const offers = offeredPurposes(setup).filter(({ purpose }) =>
    purposes.some((needed) => needed === purpose)
  );
  const events = await db
    .selectDistinctOn([consentEvent.purpose], {
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
        eq(consentEvent.subjectId, profileId),
        eq(consentEvent.competitionId, competitionId),
        inArray(consentEvent.purpose, purposes)
      )
    )
    .orderBy(consentEvent.purpose, desc(consentEvent.id));

  const given = new Set(
    purposes.filter((purpose) => {
      const attached = offers.find((offer) => offer.purpose === purpose)
        ?.document.id;
      const latest = events.find((event) => event.purpose === purpose);
      const consent: CurrentConsent =
        !latest ||
        latest.documentId !== attached ||
        (latest.method === "paper_form" &&
          (latest.formStatus !== "accepted" ||
            !latest.formUses?.includes(purpose) ||
            latest.formDocuments?.[purpose]?.documentId !== attached))
          ? { status: "never" }
          : { status: latest.action, method: latest.method };
      return decideSchoolRouteUse({
        use: purpose,
        institutionDeclared: false,
        consent,
      }).allowed;
    })
  );
  return resolvePublicCredit(person, use, given);
}
