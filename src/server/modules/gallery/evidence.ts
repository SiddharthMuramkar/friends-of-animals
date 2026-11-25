import { and, desc, eq, inArray } from "drizzle-orm";
import type { AppDb } from "../../db/app-db";
import { competition, competitionAgeGroup, consentEvent, entry, guardian, guardianLink, participantProfile, registration, type GalleryItemRow } from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import { publicUse } from "../consent";
import { lockProfileSubject, lockUserSubject } from "../consent/repository";
import { childDateOfBirth } from "../guardians/child-view";
import { activeLinkOf, verifiedLink } from "../guardians/child-access";
import { isAdultAt } from "../participants/domain/age";
import { liveEntryStampSource, stampedImage } from "../stamping";
import { publishedRecognitionForEntry } from "../results/read-published";

type Context = Pick<UseCaseContext, "db" | "cipher">;
export async function entryFacts(db: AppDb, entryId: string) {
  const [row] = await db.select({ entry, registration, profile: participantProfile, competition, category: competitionAgeGroup.label })
    .from(entry)
    .innerJoin(registration, eq(entry.registrationId, registration.id))
    .innerJoin(participantProfile, eq(entry.participantProfileId, participantProfile.id))
    .innerJoin(competition, eq(entry.competitionId, competition.id))
    .innerJoin(competitionAgeGroup, eq(registration.ageGroupId, competitionAgeGroup.id))
    .where(eq(entry.id, entryId));
  return row ?? null;
}

export async function eligibleEntry(ctx: Context, entryId: string, lock = false) {
  let facts = await entryFacts(ctx.db, entryId);
  if (lock && facts) {
    await lockProfileSubject(ctx.db, facts.profile.id);
    facts = await entryFacts(ctx.db, entryId);
  }
  if (!facts || !["foa_verified", "not_shortlisted"].includes(facts.entry.status) || !["enrolled", "confirmed"].includes(facts.registration.status) || facts.competition.status === "cancelled")
    return { eligible: false, reason: "entry_not_finished" } as const;
  const { profile, registration: reg } = facts;
  const minor = !isAdultAt(childDateOfBirth(ctx, profile).date, reg.createdAt);
  const userId = profile.ownerKind === "self" ? profile.ownerUserId : profile.loginUserId;
  const subjectId = minor ? profile.id : userId;
  if (!subjectId) return { eligible: false, reason: "no_public_display_consent" } as const;
  if (lock && !minor) await lockUserSubject(ctx.db, subjectId);
  const evidence = async () => {
    return ctx.db.select().from(consentEvent).where(and(
      eq(consentEvent.subjectType, minor ? "participant_profile" : "user"),
      eq(consentEvent.subjectId, subjectId),
      eq(consentEvent.competitionId, facts.competition.id),
      inArray(consentEvent.purpose, ["public_display", "display_school", "display_city"]),
    )).orderBy(...(minor ? [desc(consentEvent.id)] : [desc(consentEvent.occurredAt), desc(consentEvent.id)]));
  };
  const events = await evidence();
  const grant = events.find((e) => e.purpose === "public_display");
  if (!grant || grant.action !== "given") return { eligible: false, reason: "no_public_display_consent" } as const;
  const approved = async (event: typeof grant | undefined) => {
    if (!event || event.action !== "given") return false;
    if (!minor) return event.giverUserId === subjectId && event.method === "web_form";
    if (profile.ownerKind === "institution") return ["otp_link", "paper_form"].includes(event.method);
    if (event.method !== "web_form" || !event.giverUserId) return false;
    const [active] = await ctx.db.select({ id: guardianLink.id }).from(guardianLink)
      .innerJoin(guardian, eq(guardianLink.guardianId, guardian.id))
      .where(and(activeLinkOf(event.giverUserId, profile.id), verifiedLink())).limit(1);
    return !!active;
  };
  const credit = await publicUse(ctx, { profileId: profile.id, competitionId: facts.competition.id, use: "gallery" });
  if (!credit || !await approved(grant)) return { eligible: false, reason: "no_public_display_consent" } as const;
  if (credit.school && !await approved(events.find((e) => e.purpose === "display_school"))) delete credit.school;
  if (credit.city && !await approved(events.find((e) => e.purpose === "display_city"))) delete credit.city;
  // A concurrent change between evidence and credit reads cannot combine an
  // old credit with a newer grant; refuse until the next consistent read.
  const latest = await evidence();
  if (["public_display", "display_school", "display_city"].some((purpose) => latest.find((e) => e.purpose === purpose)?.id !== events.find((e) => e.purpose === purpose)?.id))
    return { eligible: false, reason: "no_public_display_consent" } as const;
  const fileId = await liveEntryStampSource(ctx.db, entryId);
  if (!fileId) return { eligible: false, reason: "no_safe_image" } as const;
  const image = await stampedImage(ctx, { fileId, variant: "gallery" });
  const award = await publishedRecognitionForEntry(ctx.db, entryId);
  return { eligible: true, facts, consentEventId: grant.id, fileId, credit, image, award } as const;
}

/** The one trusted source for downstream social export: caller still needs
 * its own social permission, stamp variant and resource authorization. */
export async function liveGallerySource(ctx: Context, item: GalleryItemRow) {
  if (item.status !== "published" || !item.reviewed) return null;
  const source = await eligibleEntry(ctx, item.entryId);
  return source.eligible && source.consentEventId === item.consentEventId && source.fileId === item.fileId && source.image ? source : null;
}
