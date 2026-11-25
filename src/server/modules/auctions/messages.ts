import { and, eq, isNotNull, desc } from "drizzle-orm";
import type { AppDb } from "../../db/app-db";
import {
  auctionOffer,
  auctionBid,
  auctionLot,
  physicalArtwork,
  registration,
  participantProfile,
  consentEvent,
  consentLink,
  messageRoute,
  messageTemplate,
} from "../../db/schema";
import type { FieldCipher } from "../../crypto/field-cipher";
import type { OutboxDeps, Delivery } from "../../outbox";
import { guardianLinksByProfile } from "../guardians/participant-audience";
import { institutionCoordinators } from "../competitions/cancellation-message";
import { isAdultAt } from "../participants/domain/age";
import { parseIsoDate } from "../registration/domain/calendar-date";
import { PROFILE_PURPOSE } from "../registration/student-profile";
import { LINK_CONTACT } from "../consent-links/repository";
import { sendToContact } from "../notifications/contact-delivery";
import { normaliseEmailAddress } from "../../ports/email";

export async function offeredBuyer(db: AppDb, id: string) {
  const [row] = await db
    .select({ userId: auctionBid.bidderUserId })
    .from(auctionOffer)
    .innerJoin(auctionBid, eq(auctionBid.id, auctionOffer.bidId))
    .innerJoin(auctionLot, eq(auctionLot.id, auctionOffer.lotId))
    .where(
      and(
        eq(auctionOffer.id, id),
        eq(auctionOffer.status, "open"),
        eq(auctionLot.status, "awaiting_payment")
      )
    );
  return row?.userId ? [row.userId] : [];
}
export async function offerValues(
  db: AppDb,
  id: string
): Promise<Record<string, string>> {
  const [row] = await db
    .select({
      lotCode: auctionOffer.lotCode,
      amount: auctionOffer.amountPaise,
      expiresAt: auctionOffer.expiresAt,
    })
    .from(auctionOffer)
    .where(eq(auctionOffer.id, id));
  return row
    ? {
        "lot.code": row.lotCode,
        "offer.link": `/account/auctions/${row.lotCode}`,
        "offer.deadline":
          new Intl.DateTimeFormat("en-IN", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Asia/Kolkata",
          }).format(row.expiresAt) + " IST",
      }
    : {};
}
async function saleFacts(db: AppDb, id: string) {
  const [row] = await db
    .select({
      offer: auctionOffer,
      reg: registration,
      profile: participantProfile,
      consentId: auctionLot.consentEventId,
    })
    .from(auctionOffer)
    .innerJoin(auctionLot, eq(auctionLot.id, auctionOffer.lotId))
    .innerJoin(physicalArtwork, eq(physicalArtwork.id, auctionLot.artworkId))
    .innerJoin(
      registration,
      eq(registration.id, physicalArtwork.registrationId)
    )
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, registration.participantProfileId)
    )
    .where(
      and(
        eq(auctionOffer.id, id),
        eq(auctionOffer.status, "paid"),
        eq(auctionLot.status, "sold")
      )
    );
  return row ?? null;
}
export async function creatorRecipients(
  db: AppDb,
  id: string,
  cipher: FieldCipher
) {
  const row = await saleFacts(db, id);
  if (!row || row.reg.route !== "individual" || !row.offer.paidAt) return [];
  const dob = parseIsoDate(
    cipher.decrypt(PROFILE_PURPOSE.dob, row.profile.dobCiphertext)
  );
  if (!dob) return [];
  if (
    !isAdultAt(dob, row.offer.paidAt) ||
    row.profile.ownerKind === "guardian"
  ) {
    if (await communicationsWithdrawn(db, row.profile.id)) return [];
    return [
      ...new Set(
        (
          (await guardianLinksByProfile(db, [row.profile.id])).get(
            row.profile.id
          ) ?? []
        )
          .filter((l) => l.verified && !l.revoked)
          .map((l) => l.userId)
      ),
    ];
  }
  return row.profile.ownerKind === "self" && row.profile.ownerUserId
    ? [row.profile.ownerUserId]
    : [];
}
export async function saleValues(
  db: AppDb,
  id: string
): Promise<Record<string, string>> {
  const row = await saleFacts(db, id);
  return row ? { "lot.code": row.offer.lotCode } : {};
}
export async function schoolRecipients(db: AppDb, id: string) {
  const row = await saleFacts(db, id);
  return row?.reg.route === "institution" && row.reg.institutionRegistrationId
    ? institutionCoordinators(db, row.reg.institutionRegistrationId)
    : [];
}
async function communicationsWithdrawn(db: AppDb, profileId: string) {
  const [last] = await db
    .select({ action: consentEvent.action })
    .from(consentEvent)
    .where(
      and(
        eq(consentEvent.subjectType, "participant_profile"),
        eq(consentEvent.subjectId, profileId),
        eq(consentEvent.purpose, "communications")
      )
    )
    .orderBy(desc(consentEvent.id))
    .limit(1);
  return last?.action === "withdrawn";
}
/** A school family email is used only if it is still the verified OTP contact
 * for the actual auction consent. Signed-form-only evidence is handled by the
 * school acknowledgement, not an unverified external address. */
export async function sendSaleFamilyLetter(
  deps: OutboxDeps,
  delivery: Delivery<"auction.sale_captured">
) {
  const row = await saleFacts(deps.db, delivery.payload.offerId);
  if (
    !row ||
    row.reg.route !== "institution" ||
    !row.consentId ||
    (await communicationsWithdrawn(deps.db, row.profile.id))
  )
    return;
  const [link] = await deps.db
    .select({ contact: consentLink.contactCiphertext })
    .from(consentEvent)
    .innerJoin(consentLink, eq(consentLink.id, consentEvent.consentLinkId))
    .where(
      and(
        eq(consentEvent.id, row.consentId),
        eq(consentLink.status, "used"),
        eq(consentLink.channel, "email"),
        isNotNull(consentLink.verifiedAt),
        eq(consentLink.studentRegistrationId, row.reg.id)
      )
    );
  if (!link || !row.profile.guardianEmailCiphertext) return;
  const address = normaliseEmailAddress(
    deps.cipher.decrypt(LINK_CONTACT, link.contact)
  );
  if (
    !address ||
    address !==
      normaliseEmailAddress(
        deps.cipher.decrypt(
          PROFILE_PURPOSE.guardianEmail,
          row.profile.guardianEmailCiphertext
        )
      )
  )
    return;
  const [route] = await deps.db
    .select()
    .from(messageRoute)
    .where(
      and(
        eq(messageRoute.eventType, delivery.eventType),
        eq(messageRoute.audience, "family_contact"),
        eq(messageRoute.enabled, true)
      )
    );
  if (!route || !route.channels.includes("email")) return;
  const [template] = await deps.db
    .select()
    .from(messageTemplate)
    .where(
      and(
        eq(messageTemplate.key, route.templateKey),
        eq(messageTemplate.channel, "email"),
        eq(messageTemplate.locale, "en-IN")
      )
    );
  if (!template) return;
  const failure = await sendToContact(
    deps,
    {
      delivery,
      route,
      templates: { email: template },
      contactKey: `email:${address}`,
      email: address,
      phone: null,
      values: {
        ...(await saleValues(deps.db, row.offer.id)),
        "recipient.name": "Parent or guardian",
      },
    },
    false
  );
  if (failure) throw failure;
}
