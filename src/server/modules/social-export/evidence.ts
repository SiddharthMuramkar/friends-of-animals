import { and, desc, eq } from "drizzle-orm";
import {
  consentEvent,
  galleryItem,
  guardian,
  guardianLink,
  type GalleryItemRow,
  type SocialExportRow,
} from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import { galleryRow, liveGallerySource } from "../gallery";
import { eligibleEntry } from "../gallery/evidence";
import { publicUse } from "../consent";
import { competitionSetup } from "../consent/child-consent";
import { activeLinkOf, verifiedLink } from "../guardians/child-access";
import { childDateOfBirth } from "../guardians/child-view";
import { isAdultAt } from "../participants/domain/age";

/** Mutations and downloads acquire the same subject → gallery order as curation. */
export async function lockedGallery(ctx: UseCaseContext, itemId: string) {
  const prior = await galleryRow(ctx, itemId);
  if (!prior) return null;
  // The subject locks also serialize give/withdraw and profile changes.
  await eligibleEntry(ctx, prior.entryId, true);
  const [row] = await ctx.db
    .select()
    .from(galleryItem)
    .where(eq(galleryItem.id, itemId))
    .for("update");
  return row ?? null;
}

/** Social use is distinct from gallery consent, including its document pin and
 * exact current grant. Never accept a viewer-supplied credit or file. */
export async function liveSocialSource(
  ctx: Pick<UseCaseContext, "db" | "cipher">,
  gallery: GalleryItemRow
) {
  const source = await liveGallerySource(ctx, gallery);
  if (!source) return { ok: false, error: "gallery_unavailable" } as const;
  const { profile, competition, registration } = source.facts;
  const noConsent = { ok: false, error: "no_social_consent" } as const;
  const minor = !isAdultAt(
    childDateOfBirth(ctx, profile).date,
    registration.createdAt
  );
  const userId =
    profile.ownerKind === "self" ? profile.ownerUserId : profile.loginUserId;
  const subjectId = minor ? profile.id : userId;
  if (!subjectId) return noConsent;
  const setup = await competitionSetup(ctx.db, competition.id);
  const documentId = setup?.setup.attached.social_media?.id;
  if (!setup?.setup.publicDisplayAllowed || !documentId) return noConsent;
  const latestGrant = async () =>
    (
      await ctx.db
        .select()
        .from(consentEvent)
        .where(
          and(
            eq(
              consentEvent.subjectType,
              minor ? "participant_profile" : "user"
            ),
            eq(consentEvent.subjectId, subjectId),
            eq(consentEvent.competitionId, competition.id),
            eq(consentEvent.purpose, "social_media")
          )
        )
        .orderBy(
          ...(minor
            ? [desc(consentEvent.id)]
            : [desc(consentEvent.occurredAt), desc(consentEvent.id)])
        )
        .limit(1)
    )[0];
  const grant = await latestGrant();
  if (!grant || grant.action !== "given" || grant.documentId !== documentId)
    return noConsent;
  if (!minor) {
    if (grant.giverUserId !== subjectId || grant.method !== "web_form")
      return noConsent;
  } else if (profile.ownerKind === "institution") {
    if (
      registration.route !== "institution" ||
      !["otp_link", "paper_form"].includes(grant.method)
    )
      return noConsent;
  } else {
    if (!grant.giverUserId || grant.method !== "web_form") return noConsent;
    const [link] = await ctx.db
      .select({ id: guardianLink.id })
      .from(guardianLink)
      .innerJoin(guardian, eq(guardianLink.guardianId, guardian.id))
      .where(and(activeLinkOf(grant.giverUserId, profile.id), verifiedLink()))
      .limit(1);
    if (!link) return noConsent;
  }
  // publicUse verifies school-route OTP/form evidence and the independent
  // credit choices. The gallery source additionally verifies field opt-ins.
  const credit = await publicUse(ctx, {
    profileId: profile.id,
    competitionId: competition.id,
    use: "social_media",
  });
  if (!credit || (await latestGrant())?.id !== grant.id) return noConsent;
  if (credit.school !== source.credit.school) delete credit.school;
  if (credit.city !== source.credit.city) delete credit.city;
  return {
    ok: true,
    fileId: source.fileId,
    galleryConsentEventId: source.consentEventId,
    socialConsentEventId: grant.id,
    credit,
    sampleIllustration: source.image?.sampleIllustration ?? false,
  } as const;
}

export function matchesSource(
  row: SocialExportRow,
  source: Extract<Awaited<ReturnType<typeof liveSocialSource>>, { ok: true }>
) {
  return (
    row.galleryConsentEventId === source.galleryConsentEventId &&
    row.socialConsentEventId === source.socialConsentEventId &&
    row.fileId === source.fileId
  );
}
