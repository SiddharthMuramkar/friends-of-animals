import {
  PRIZE_VARIABLES,
  prizeRecipients,
  prizeValues,
} from "../results/messages";
import {
  ARTWORK_VARIABLES,
  artworkRecipients,
  artworkValues,
} from "../physical-artwork/messages";
import {
  VERIFICATION_VARIABLES,
  verificationValues,
} from "../verification/message-values";
// Who a route's message goes to, and what each event lets a template say.
//
// A route row names an audience by key. Each audience turns an event into
// the users who receive it: by default on every channel the route names; a
// member may be limited to the inbox, or recorded as told nothing (#81: a
// minor with no verified guardian). Later tickets add an audience here and
// route rows that use it, in a migration; #88 added `competition_managers`,
// #81 `guardian_of_participant`, #80 `institution_coordinators`, #123
// `volunteer_applicant`, `volunteer_guardians` and `community_managers`,
// #130 `adoption_applicant`, `adoption_listing_representatives` and
// `adoption_coordinators`.
//
// Every message knows its recipient (RECIPIENT_VARIABLES). An event may
// give more variables (EVENT_VARIABLES): the names it provides and how to
// load their values from its payload. A template may only use what its
// routes' events and recipients provide; ./catalogue.test.ts checks every
// route row against this file.
//
// Loads under plain Node (the worker): relative imports only.

import { and, asc, eq, or } from "drizzle-orm";
import { createFormatter, createTranslator } from "next-intl";

import adminRubrics from "../../../../messages/en-IN/adminRubrics.json";
import competitionStatus from "../../../../messages/en-IN/competitionStatus.json";
import { formats, LOCALE } from "../../../i18n/formats";
import type { FieldCipher } from "../../crypto/field-cipher";
import type { AppDb } from "../../db/app-db";
import {
  competition,
  competitionTransitionBlock,
  auctionBid,
  auctionLot,
  institution,
  userRole,
} from "../../db/schema";
import type { Delivery, EventType } from "../../outbox";
import {
  CONTACT_MESSAGE_VARIABLES,
  contactMessageValues,
  contactTeamMembers,
} from "../contact/notify";
import {
  ANNOUNCEMENT_VARIABLES,
  announcementMessageFor,
} from "../announcements/render";
import {
  LISTING_DECISION_VARIABLES,
  listingDecisionValues,
} from "../directory/decision-message";
import {
  ENTRY_ATTEMPT_VARIABLES,
  ENTRY_RECEIPT_VARIABLES,
  entryValues,
} from "../entries/message-values";
import { CAMPAIGN_VARIABLES, campaignEventValues } from "../campaigns/render";
import { guardianOfParticipant } from "../guardians/participant-audience";
import { safeguardingLeads } from "../safeguarding/leads";
import { grievanceOfficers } from "../privacy/requests/people";
import {
  DIGEST_VARIABLES,
  digestValues,
  REQUEST_VARIABLES,
  requesterOf,
  requestValues,
} from "../privacy/requests/messages";
import {
  AUTHORITY_NOTICE_VARIABLES,
  PRINCIPAL_NOTICE_VARIABLES,
} from "../breaches/notice-message";
import { ownerOfRegistration } from "../participants/owner";
import {
  REMINDER_VARIABLES,
  reminderValues,
} from "../reminders/message-values";
import { payerOn, RECEIPT_VARIABLES, receiptValues } from "../payments/receipt";
import {
  dashboardRefundValues,
  financeTeam,
  REFUND_VARIABLES,
  refundValues,
} from "../payments/refunds/notice";
import {
  CONFIRMATION_VARIABLES,
  confirmationValues,
} from "../registration/confirmation-message";
import {
  CANCELLATION_VARIABLES,
  cancellationValues,
  INSTITUTION_CANCELLATION_VARIABLES,
  institutionCancellationValues,
  institutionCoordinators,
} from "../competitions/cancellation-message";
import {
  TRANSITION_BLOCK,
  type TransitionBlock,
} from "../competitions/domain/transition-block";
import {
  APPLICATION_VARIABLES,
  applicationValues,
  communityManagers,
  DECLINED_VARIABLES,
  volunteerApplicant,
  volunteerGuardians,
} from "../volunteers/message-audiences";
import {
  ADOPTION_APPLICATION_VARIABLES,
  adoptionApplicant,
  adoptionApplicationValues,
  adoptionCoordinators,
  adoptionListingRepresentatives,
} from "../adoption/applications/messages";
import {
  outcomeValues,
  SCHOOL_ROUND_OUTCOME_VARIABLES,
} from "../school-round/family-outcomes";
import {
  overdueValues,
  SCHOOL_ROUND_OVERDUE_VARIABLES,
} from "../school-round/overdue";
import type { AudienceMember } from "./domain/audience-member";

/** The variables every message has about the person receiving it. */
export const RECIPIENT_VARIABLES = ["recipient.name"] as const;

/** The user an event is about, if it is about a user. */
function subjectUserOf(delivery: Delivery): string | null {
  switch (delivery.eventType) {
    case "consent.form_reviewed":
      return delivery.payload.uploaderUserId;
    case "identity.user_signed_up":
      return delivery.payload.userId;
    case "consent.withdrawn":
      // The withdrawal receipt answers a person's own messages consent
      // only: a child's consents (#82) are no user's, and the receipt
      // speaks of messages, not of any other purpose.
      return delivery.payload.subjectType === "user" &&
        delivery.payload.purpose === "messages"
        ? delivery.payload.subjectId
        : null;
    case "consent.link_sent":
    case "contact_message.received":
      // A visitor's message (#113): its sender has no account.
      return null;
    case "files.file_uploaded":
    case "files.processing_requested":
    case "files.video_processing_requested":
    case "files.pdf_processing_requested":
    case "files.file_ready":
    case "files.file_processed":
    case "files.file_processing_failed":
    case "files.file_quarantined":
    case "files.file_rejected":
    case "entry.upload_grant_issued":
    case "entry.sweep_staged_upload":
      // A file's own pipeline (#63, #85), not a message route: no route
      // row names these events.
      return null;
    case "institution.verified":
    case "institution.rejected":
    case "institution.suspended":
    case "institution.reinstated":
      // The authorised person, who registered the institution (#73).
      return delivery.payload.userId;
    case "directory.listing_verified":
    case "directory.listing_rejected":
    case "directory.listing_suspended":
    case "directory.listing_reinstated":
      // The person who registered the listing hears FOA's decision (#127).
      return delivery.payload.userId;
    case "directory.listing_submitted":
      // For staff, who find it in the review queue; no route row names it.
      return null;
    case "competitions.key_date_scheduled":
      // A status job (#71): it's about a competition, not a user, and no
      // route row names it.
      return null;
    case "competition.published":
    case "competition.key_dates_changed":
    case "competition.cancelled":
      // Keep a competition's reminders in step (#84); no route row names them.
      return null;
    case "reminder.due":
      // For whoever owes the deadline (`reminder_registrants`,
      // `reminder_contacts`), planned by the reminders handler (#84).
      return null;
    case "judging.judge_invited":
    case "institution.coordinator_invited":
      // The invitee may have no account yet: the invitation goes to the
      // invited address by its own handler (#74), not by a route row.
      return null;
    case "safeguarding.report_submitted":
      // About a child, never about a user: only the leads hear of it.
      return null;
    case "cms.post_scheduled":
    case "cms.post_published":
      // A post (#112): it's about content, not a user.
      return null;
    case "competition.transition_blocked":
      // For the competition's managers (`competition_managers`).
      return null;
    case "rubric.published":
    case "competition.disciplines_changed":
      // Re-runs a refused move (#88); no route row names it.
      return null;
    case "registration.institution_registered":
      // The principal isn't a user: their message goes by its own handler
      // (#75), not by a route row.
      return null;
    case "registration.confirmed":
      // The family contact isn't a user: their message goes by its own
      // handler (#77), not by a route row.
      return null;
    case "payment.batch_captured":
      // Whoever started the payment gets the receipt (#77).
      return delivery.payload.payerUserId;
    case "recurring_donation.activated":
    case "recurring_donation.charge_failed":
    case "recurring_donation.cancelled":
    case "recurring_donation.refunded":
    case "recurring_donation.payment_refused":
    case "recurring_donation.cancel_requested":
    case "donation.captured":
    case "donation.foreign_payment_received":
    case "donation.refunded":
    case "receipt.link_requested":
      // A guest donor has no account: the donations module emails the
      // address they gave, and tells a signed-in donor in-app (#106).
      return null;
    case "guardian.teen_invited":
      // The teen may have no account yet: the invitation goes to the
      // invited address by its own handler (#81), not by a route row.
      return null;
    case "refund.approved":
      // The funnel to the gateway (#80); no route row names it.
      return null;
    case "refund.processed":
    case "refund.dashboard_processed":
      // Whoever started the batch's payment is told their money is back.
      return delivery.payload.payerUserId;
    case "refund.failed":
      // For the finance team (`finance_team`), not a user it is about.
      return null;
    case "guardian.guardian_requested":
      // The guardian a teen names may have no account yet: the request
      // goes to the address the teen gave by its own handler (#81).
      return null;
    case "breach.principal_notice":
      // Possibly a guardian, told about a child: `breach_recipient` names
      // whoever the breaches module planned (#116).
      return null;
    case "breach.fan_out_requested":
    case "breach.authority_notice":
      // The fan-out job and the authority's own email (#116); no route row
      // sends to a user for either.
      return null;
    case "entry.foa_verified":
    case "entry.sent_back":
    case "entry.submitted":
    case "entry.file_rejected":
    case "entry.file_failed":
      // About a registration's entry (#85): `registration_owner` and
      // `guardian_of_participant` find who hears of it.
      return null;
    case "competition.announcement_sent":
      // For a competition's registrants (`announcement_registrants`).
      return null;
    case "registration.competition_cancelled":
      // The family contact goes by its own handler; an adult's own by
      // `registration_owner`, a minor's guardians by
      // `guardian_of_participant` (#80).
      return null;
    case "institution_registration.competition_cancelled":
      // For its coordinators (`institution_coordinators`, #80).
      return null;
    case "privacy_request.submitted":
    case "privacy_request.rejected":
    case "privacy_request.completed":
    case "privacy_request.overdue_digest":
      // A request's requester (`privacy_requester`), the grievance
      // officers (`grievance_officers`, `grievance_digest`), #115.
      return null;
    case "privacy_request.export_requested":
    case "privacy_request.export_expired":
    case "privacy_request.erasure_approved":
      // The export and erasure jobs (#115b); no route row names them.
      return null;
    case "volunteer.guardian_approval_requested":
    case "volunteer.application_submitted":
    case "volunteer.application_approved":
    case "volunteer.application_declined":
      // About an application (#123): `volunteer_applicant`,
      // `volunteer_guardians` and `community_managers` find who hears.
      return null;
    case "campaign.message_due":
      // The campaigns module sends it to its planned recipient (#126).
      return null;
    case "artwork.verified":
    case "artwork.discrepancy_raised":
    case "artwork.discrepancy_resolved":
    case "artwork.exhibited":
    case "artwork.stored":
    case "artwork.retained":
    case "artwork.return_requested":
    case "artwork.returned":
    case "results.release_due":
    case "results.prize_awarded":
    case "results.published":
    case "auction.lot_created":
    case "auction.lot.open":
    case "auction.lot.close":
    case "auction.lot_opened":
    case "auction.lot_closed":
    case "auction.bid_outbid":
    case "auction.lot_cancelled":
    case "artwork.retain_unrequested":
    case "artwork.requested":
    case "artwork.dispatched":
    case "artwork.received":
    case "entry.replacement_live":
    case "competition.submissions_closed":
    case "competition.school_judging_started":
    case "school_round.shortlist_finalised":
    case "school_round.closed_on_behalf":
      // Open the rounds and queue the families' messages (#89, #90); no
      // route row names them.
      return null;
    case "school_round.overdue":
      // For the school's coordinators (`institution_coordinators`, #90).
      return null;
    case "entry.school_shortlisted":
    case "entry.not_shortlisted":
    case "registration.not_shortlisted":
      // The family contact isn't a user: their message goes by the school
      // round's own handler (#89), not by a route row.
      return null;
    case "adoption.application_submitted":
    case "adoption.application_under_review":
    case "adoption.application_in_contact":
    case "adoption.application_adopted":
    case "adoption.application_not_matched":
    case "adoption.application_declined":
    case "adoption.application_withdrawn":
    case "adoption.application_listing_closed":
      // About an adoption application (#130): `adoption_applicant`,
      // `adoption_listing_representatives` and `adoption_coordinators`
      // find who hears.
      return null;
  }
}

/** The adoption application an event is about (#130). */
function adoptionApplicationOf(delivery: Delivery): string | null {
  switch (delivery.eventType) {
    case "adoption.application_submitted":
    case "adoption.application_under_review":
    case "adoption.application_in_contact":
    case "adoption.application_adopted":
    case "adoption.application_not_matched":
    case "adoption.application_declined":
    case "adoption.application_withdrawn":
    case "adoption.application_listing_closed":
      return delivery.payload.applicationId;
    default:
      return null;
  }
}

/** The volunteer application an event is about (#123). */
function volunteerApplicationOf(delivery: Delivery): string | null {
  switch (delivery.eventType) {
    case "volunteer.guardian_approval_requested":
    case "volunteer.application_submitted":
    case "volunteer.application_approved":
    case "volunteer.application_declined":
      return delivery.payload.applicationId;
    default:
      return null;
  }
}

/** The individual registration an event is about, for its owner or guardians. */
function registrationOf(delivery: Delivery): string | null {
  switch (delivery.eventType) {
    case "registration.confirmed":
    case "entry.foa_verified":
    case "entry.sent_back":
    case "entry.submitted":
    case "entry.file_rejected":
    case "entry.file_failed":
      return delivery.payload.registrationId;
    default:
      return null;
  }
}

/** The competition an event is about, if a competition audience applies. */
function competitionOf(delivery: Delivery): string | null {
  switch (delivery.eventType) {
    case "competition.transition_blocked":
      return delivery.payload.competitionId;
    default:
      return null;
  }
}

export type { AudienceMember };

type Audience = (
  db: AppDb,
  delivery: Delivery,
  cipher?: FieldCipher
) => Promise<AudienceMember[]>;

/** Each audience key a route may name, and the user ids it resolves to. */
export const AUDIENCES = {
  prize_recipients: async (db, delivery, cipher) =>
    delivery.eventType === "results.prize_awarded" && cipher
      ? prizeRecipients(db, delivery.payload, cipher)
      : [],
  artwork_sender: async (db, delivery) =>
    delivery.eventType === "artwork.requested" ||
    delivery.eventType === "artwork.received"
      ? artworkRecipients(
          db,
          delivery.payload.artworkId,
          delivery.eventType === "artwork.received"
        )
      : [],

  /** The user the event is about: the new account, the one who withdrew. */
  subject_user: async (db, delivery) => {
    // The institution's receipt; an adult's own goes as individual_payer.
    if (delivery.eventType === "payment.batch_captured") {
      return payerOn(db, delivery.payload.batchId, "institution");
    }
    const userId = subjectUserOf(delivery);
    return userId ? [userId] : [];
  },
  /** The displaced bidder, not the new leader. Resolve at delivery time so
   * an erased bid's former account cannot receive anything. */
  outbid_bidder: async (db, delivery) => {
    if (delivery.eventType !== "auction.bid_outbid") return [];
    const [bid] = await db
      .select({ userId: auctionBid.bidderUserId })
      .from(auctionBid)
      .where(eq(auctionBid.id, delivery.payload.previousBidId));
    return bid?.userId ? [bid.userId] : [];
  },
  /** Whoever paid for their own registration (#78): their receipt. */
  individual_payer: async (db, delivery) =>
    delivery.eventType === "payment.batch_captured"
      ? payerOn(db, delivery.payload.batchId, "individual")
      : [],
  /**
   * The adult whose own registration it is (#78), for its confirmation and
   * its entry's messages (#85); a school's student has none, so nobody
   * receives it here.
   */
  registration_owner: async (db, delivery) => {
    // A registration still held for a guardian when its competition was
    // cancelled (#80) is a minor's: their guardians hear of it instead.
    if (delivery.eventType === "registration.competition_cancelled") {
      return delivery.payload.awaitingGuardian
        ? []
        : ownerOfRegistration(db, delivery.payload.registrationId);
    }
    const registrationId = registrationOf(delivery);
    return registrationId ? ownerOfRegistration(db, registrationId) : [];
  },
  /**
   * The guardians of the child a registration is for (#81): messages about
   * a minor go to them, and a teen with an own login gets an inbox copy. A
   * minor with no verified guardian is told nothing. An adult's own
   * registration has none here: `registration_owner` tells them.
   * Later events about a registration can add their own route here.
   * Financial receipts and refunds go to the payer's account.
   */
  guardian_of_participant: async (db, delivery) => {
    if (delivery.eventType === "registration.competition_cancelled") {
      return guardianOfParticipant(
        db,
        delivery.payload.registrationId,
        delivery.payload.awaitingGuardian
      );
    }
    const registrationId = registrationOf(delivery);
    return registrationId ? guardianOfParticipant(db, registrationId) : [];
  },
  /**
   * Everyone who acts for an institution registration's institution: its
   * coordinators and its authorised person (#80: its competition was
   * cancelled; #90: its school round is overdue).
   */
  institution_coordinators: async (db, delivery) =>
    (delivery.eventType === "institution_registration.competition_cancelled" ||
      delivery.eventType === "school_round.overdue" ||
      delivery.eventType === "entry.foa_verified" ||
      delivery.eventType === "entry.sent_back") &&
    delivery.payload.institutionRegistrationId
      ? institutionCoordinators(db, delivery.payload.institutionRegistrationId)
      : [],
  /**
   * Whoever wrote through the contact form (#113). They have no account, so
   * no user receives it here: the contact module emails their address with
   * this route's template while the route is enabled.
   */
  contact_sender: async () => [],
  /**
   * A confirmed registration's family contact (#77): a minor's guardian or
   * the adult student, kept on the participant profile, not a user. No user
   * receives it here: the registration module emails them with this
   * route's template while the route is enabled.
   */
  family_contact: async () => [],
  /**
   * Whoever gave a donation (#106), who may have no account. No user
   * receives it here: the donations module sends the route's template to
   * the donor's address, and in-app to a signed-in donor.
   */
  donor: async () => [],
  /** The staff team a contact message was routed to (#113). */
  contact_team: async (db, delivery) =>
    delivery.eventType === "contact_message.received"
      ? contactTeamMembers(db, delivery.payload.messageId)
      : [],
  /** Every safeguarding lead (#116), whatever the event. */
  safeguarding_leads: async (db) =>
    (await safeguardingLeads(db)).map((lead) => lead.id),
  /**
   * Everyone who manages the event's competition: a competition manager
   * scoped to it, or one with a global grant (#88).
   */
  competition_managers: async (db, delivery) => {
    const competitionId = competitionOf(delivery);
    if (!competitionId) return [];
    const rows = await db
      .selectDistinct({ userId: userRole.userId })
      .from(userRole)
      .where(
        and(
          eq(userRole.role, "competition_manager"),
          or(
            eq(userRole.scopeType, "global"),
            and(
              eq(userRole.scopeType, "competition"),
              eq(userRole.scopeId, competitionId)
            )
          )
        )
      )
      .orderBy(asc(userRole.userId));
    return rows.map((row) => row.userId);
  },
  /** Everyone holding the finance role (#80): a refund needs them. */
  finance_team: async (db) => financeTeam(db),
  /** The announcements handler resolves both audiences from one roster. */
  announcement_registrants: async () => [],
  announcement_contacts: async () => [],
  /** Whoever filed a privacy request (#115): its receipt and outcome. */
  privacy_requester: async (db, delivery) => {
    switch (delivery.eventType) {
      case "privacy_request.submitted":
      case "privacy_request.rejected":
      case "privacy_request.completed":
        return requesterOf(db, delivery.payload.requestId);
      default:
        return [];
    }
  },
  /** Every grievance officer (#115), whatever the event. */
  grievance_officers: async (db) =>
    (await grievanceOfficers(db)).map((officer) => officer.id),
  /** The grievance officer one overdue digest is for (#115). */
  grievance_digest: async (_db, delivery) =>
    delivery.eventType === "privacy_request.overdue_digest"
      ? [delivery.payload.officerUserId]
      : [],
  /**
   * The reminders handler resolves both from who owes the deadline when it
   * runs (#84): accounts, and roster contacts without one.
   */
  reminder_registrants: async () => [],
  reminder_contacts: async () => [],
  /**
   * The breach dispatcher checks the saved recipient and live guardian links
   * for this route. The generic audience resolver grants no recipients.
   */
  breach_recipient: async () => [],
  /**
   * The authority a breach is reported to (#116). It is an address, not a
   * user, so no user receives it here: the breaches module emails the
   * configured address with this route's template while it is enabled.
   */
  breach_authority: async () => [],
  /**
   * Whoever applied to volunteer (#123): an adult on every channel the
   * route names, a teen in the inbox only.
   */
  volunteer_applicant: async (db, delivery) => {
    const applicationId = volunteerApplicationOf(delivery);
    return applicationId ? volunteerApplicant(db, applicationId) : [];
  },
  /** A teen applicant's verified guardians (#123); nobody for an adult's. */
  volunteer_guardians: async (db, delivery) => {
    const applicationId = volunteerApplicationOf(delivery);
    return applicationId ? volunteerGuardians(db, applicationId) : [];
  },
  /** Everyone holding the community manager role everywhere (#123). */
  community_managers: async (db) => communityManagers(db),
  /** Whoever applied to adopt an animal (#130). */
  adoption_applicant: async (db, delivery) => {
    const applicationId = adoptionApplicationOf(delivery);
    return applicationId ? adoptionApplicant(db, applicationId) : [];
  },
  /** The animal's organisation's representatives (#130). */
  adoption_listing_representatives: async (db, delivery) => {
    const applicationId = adoptionApplicationOf(delivery);
    return applicationId
      ? adoptionListingRepresentatives(db, applicationId)
      : [];
  },
  /** Adoption coordinators, global or for the organisation (#130). */
  adoption_coordinators: async (db, delivery) => {
    const applicationId = adoptionApplicationOf(delivery);
    return applicationId ? adoptionCoordinators(db, applicationId) : [];
  },
  /**
   * A campaign's recipient (#126): the campaigns handler sends to the
   * person it planned, on the consent the message rests on, so the generic
   * resolver grants no recipients.
   */
  campaign_recipient: async () => [],
} satisfies Record<string, Audience>;

export type AudienceKey = keyof typeof AUDIENCES;

export function isAudienceKey(key: string): key is AudienceKey {
  return Object.hasOwn(AUDIENCES, key);
}

type EventVariables<T extends EventType> = {
  /** The names it provides, beyond RECIPIENT_VARIABLES. */
  names: readonly string[];
  load(
    db: AppDb,
    delivery: Delivery<T>,
    cipher: FieldCipher
  ): Promise<Record<string, string>>;
};

/**
 * An institution's name and, once verified, its Institution ID (#73). Both
 * are read when the message goes: neither changes after the decision.
 */
async function institutionValues(
  db: AppDb,
  institutionId: string
): Promise<Record<string, string>> {
  const [row] = await db
    .select({ name: institution.name, code: institution.institutionCode })
    .from(institution)
    .where(eq(institution.id, institutionId));
  if (!row) return {};
  return {
    "institution.name": row.name,
    ...(row.code === null ? {} : { "institution.code": row.code }),
  };
}

// A refused move's words come from messages/en-IN, like every other copy
// (FOA reviews them): the status as a sentence names it, why the move is
// held back, and each discipline as the rubric pages name it. A missing
// key fails the delivery loudly rather than mailing the key path.
function refuseFallback(error: Error): never {
  throw error;
}
const statusWords = createTranslator({
  locale: LOCALE,
  messages: competitionStatus,
  namespace: "competitionStatus",
  onError: refuseFallback,
});
const disciplineWords = createTranslator({
  locale: LOCALE,
  messages: adminRubrics,
  namespace: "adminRubrics.disciplines",
  onError: refuseFallback,
});
const format = createFormatter({ locale: LOCALE, formats });

/**
 * A refused move (#88): the competition, where it was going, and one
 * sentence on what stands in the way, from the block as it is when the
 * message goes.
 */
async function transitionBlockValues(
  db: AppDb,
  blockId: string
): Promise<Record<string, string>> {
  const [row] = await db
    .select({
      name: competition.name,
      code: competition.code,
      to: competitionTransitionBlock.toStatus,
      reason: competitionTransitionBlock.reason,
      details: competitionTransitionBlock.details,
    })
    .from(competitionTransitionBlock)
    .innerJoin(
      competition,
      eq(competition.id, competitionTransitionBlock.competitionId)
    )
    .where(eq(competitionTransitionBlock.id, blockId));
  if (!row) return {};
  const block = TRANSITION_BLOCK.parse({ ...row.details, reason: row.reason });
  return {
    "competition.name": row.name,
    "competition.code": row.code,
    "transition.to": statusWords(`inSentence.${row.to}`),
    "transition.reason": reasonSentence(block),
  };
}

/** One sentence, for managers, on what holds a move back. */
function reasonSentence(block: TransitionBlock): string {
  switch (block.reason) {
    case "rubrics_missing":
      return statusWords("blockReason.rubrics_missing", {
        disciplines: format.list(
          block.missingDisciplines.map((discipline) =>
            disciplineWords(discipline)
          ),
          "and"
        ),
      });
    case "school_rounds_unfinished":
      return statusWords("blockReason.school_rounds_unfinished", {
        unfinished: block.missing + block.open + block.overdue,
        missing: block.missing,
        open: block.open,
        overdue: block.overdue,
      });
  }
}

/** What each event lets a template say. */
export const EVENT_VARIABLES: { [T in EventType]: EventVariables<T> } = {
  "consent.form_reviewed": { names: [], load: async () => ({}) },
  "identity.user_signed_up": { names: [], load: async () => ({}) },
  "consent.withdrawn": { names: [], load: async () => ({}) },
  // Bearer links are delivered by their own handler. Their secrets never enter this map.
  "consent.link_sent": { names: [], load: async () => ({}) },
  "files.file_uploaded": { names: [], load: async () => ({}) },
  "files.processing_requested": { names: [], load: async () => ({}) },
  "files.video_processing_requested": { names: [], load: async () => ({}) },
  "files.pdf_processing_requested": { names: [], load: async () => ({}) },
  "files.file_ready": { names: [], load: async () => ({}) },
  "files.file_processed": { names: [], load: async () => ({}) },
  "files.file_processing_failed": { names: [], load: async () => ({}) },
  "files.file_quarantined": { names: [], load: async () => ({}) },
  "files.file_rejected": { names: [], load: async () => ({}) },
  "entry.upload_grant_issued": { names: [], load: async () => ({}) },
  "entry.sweep_staged_upload": { names: [], load: async () => ({}) },
  "institution.verified": {
    names: ["institution.name", "institution.code"],
    load: (db, { payload }) => institutionValues(db, payload.institutionId),
  },
  "institution.rejected": {
    names: ["institution.name"],
    load: (db, { payload }) => institutionValues(db, payload.institutionId),
  },
  "institution.suspended": {
    names: ["institution.name"],
    load: (db, { payload }) => institutionValues(db, payload.institutionId),
  },
  "institution.reinstated": {
    names: ["institution.name", "institution.code"],
    load: (db, { payload }) => institutionValues(db, payload.institutionId),
  },
  "competitions.key_date_scheduled": { names: [], load: async () => ({}) },
  "competition.published": { names: [], load: async () => ({}) },
  "competition.key_dates_changed": { names: [], load: async () => ({}) },
  "competition.cancelled": { names: [], load: async () => ({}) },
  "reminder.due": {
    names: REMINDER_VARIABLES,
    load: (db, { payload }) => reminderValues(db, payload.reminderJobId),
  },
  "judging.judge_invited": { names: [], load: async () => ({}) },
  "institution.coordinator_invited": { names: [], load: async () => ({}) },
  "directory.listing_submitted": { names: [], load: async () => ({}) },
  "directory.listing_verified": {
    names: LISTING_DECISION_VARIABLES,
    load: (db, { payload }) => listingDecisionValues(db, payload.listingId),
  },
  "directory.listing_rejected": {
    names: LISTING_DECISION_VARIABLES,
    load: (db, { payload }) => listingDecisionValues(db, payload.listingId),
  },
  "directory.listing_suspended": {
    names: LISTING_DECISION_VARIABLES,
    load: (db, { payload }) => listingDecisionValues(db, payload.listingId),
  },
  "directory.listing_reinstated": {
    names: LISTING_DECISION_VARIABLES,
    load: (db, { payload }) => listingDecisionValues(db, payload.listingId),
  },
  "contact_message.received": {
    names: CONTACT_MESSAGE_VARIABLES,
    load: async (db, delivery) =>
      (await contactMessageValues(db, delivery.payload.messageId)) ?? {},
  },
  // Nothing of the report: the alert says only that one came in (#116).
  "safeguarding.report_submitted": { names: [], load: async () => ({}) },
  "cms.post_scheduled": { names: [], load: async () => ({}) },
  "cms.post_published": { names: [], load: async () => ({}) },
  "rubric.published": { names: [], load: async () => ({}) },
  "competition.disciplines_changed": { names: [], load: async () => ({}) },
  "competition.transition_blocked": {
    names: [
      "competition.name",
      "competition.code",
      "transition.to",
      "transition.reason",
    ],
    load: (db, { payload }) => transitionBlockValues(db, payload.blockId),
  },
  "registration.institution_registered": {
    names: [],
    load: async () => ({}),
  },
  "registration.confirmed": {
    names: CONFIRMATION_VARIABLES,
    load: (db, { payload }) => confirmationValues(db, payload.registrationId),
  },
  "payment.batch_captured": {
    names: RECEIPT_VARIABLES,
    load: (db, { payload }) => receiptValues(db, payload.batchId),
  },
  // The donations module renders these itself (#106): only it can mint a
  // receipt link as the email goes. Declared so templates check out.
  "recurring_donation.activated": { names: [], load: async () => ({}) },
  "recurring_donation.charge_failed": { names: [], load: async () => ({}) },
  "recurring_donation.cancelled": { names: [], load: async () => ({}) },
  "recurring_donation.refunded": { names: [], load: async () => ({}) },
  "recurring_donation.payment_refused": { names: [], load: async () => ({}) },
  "recurring_donation.cancel_requested": { names: [], load: async () => ({}) },
  "donation.captured": {
    names: [
      "donation.amount",
      "receipt.number",
      "receipt.link",
      "receipt.expiresOn",
    ],
    load: async () => ({}),
  },
  "donation.foreign_payment_received": { names: [], load: async () => ({}) },
  "donation.refunded": {
    names: ["donation.amount", "refund.amount", "refund.reference"],
    load: async () => ({}),
  },
  "receipt.link_requested": {
    names: [
      "donation.amount",
      "receipt.number",
      "receipt.link",
      "receipt.expiresOn",
    ],
    load: async () => ({}),
  },
  "guardian.teen_invited": { names: [], load: async () => ({}) },
  "refund.approved": { names: [], load: async () => ({}) },
  "refund.processed": {
    names: REFUND_VARIABLES,
    load: (db, { payload }) => refundValues(db, payload.refundId),
  },
  "refund.dashboard_processed": {
    names: REFUND_VARIABLES,
    load: (db, { payload }) => dashboardRefundValues(db, payload.reviewCaseId),
  },
  "refund.failed": {
    names: REFUND_VARIABLES,
    load: (db, { payload }) => refundValues(db, payload.refundId),
  },
  "guardian.guardian_requested": { names: [], load: async () => ({}) },
  // Whose data it involved, never what happened (#116).
  "breach.principal_notice": {
    names: PRINCIPAL_NOTICE_VARIABLES,
    // Revalidated separately for each channel by the breach dispatcher.
    load: async () => ({}),
  },
  "breach.fan_out_requested": { names: [], load: async () => ({}) },
  "breach.authority_notice": {
    names: AUTHORITY_NOTICE_VARIABLES,
    // The authority handler renders these variables for its configured address.
    load: async () => ({}),
  },
  "registration.competition_cancelled": {
    names: CANCELLATION_VARIABLES,
    load: (db, { payload }) => cancellationValues(db, payload),
  },
  "institution_registration.competition_cancelled": {
    names: INSTITUTION_CANCELLATION_VARIABLES,
    load: (db, { payload }) =>
      institutionCancellationValues(db, payload.institutionRegistrationId),
  },
  "competition.submissions_closed": { names: [], load: async () => ({}) },
  "entry.replacement_live": { names: [], load: async () => ({}) },
  "artwork.requested": {
    names: ARTWORK_VARIABLES,
    load: (db, { payload }) => artworkValues(db, payload.artworkId),
  },
  "artwork.dispatched": { names: [], load: async () => ({}) },
  "artwork.received": {
    names: ARTWORK_VARIABLES,
    load: (db, { payload }) => artworkValues(db, payload.artworkId),
  },
  "artwork.verified": { names: [], load: async () => ({}) },
  "artwork.discrepancy_raised": { names: [], load: async () => ({}) },
  "artwork.discrepancy_resolved": { names: [], load: async () => ({}) },
  "artwork.exhibited": { names: [], load: async () => ({}) },
  "artwork.stored": { names: [], load: async () => ({}) },
  "artwork.retained": { names: [], load: async () => ({}) },
  "artwork.return_requested": { names: [], load: async () => ({}) },
  "artwork.returned": { names: [], load: async () => ({}) },
  "results.release_due": { names: [], load: async () => ({}) },
  "results.prize_awarded": {
    names: PRIZE_VARIABLES,
    load: (db, delivery) => prizeValues(db, delivery.payload),
  },
  "results.published": { names: [], load: async () => ({}) },
  "auction.lot_created": { names: [], load: async () => ({}) },
  "auction.lot.open": { names: [], load: async () => ({}) },
  "auction.lot.close": { names: [], load: async () => ({}) },
  "auction.lot_opened": { names: [], load: async () => ({}) },
  "auction.lot_closed": { names: [], load: async () => ({}) },
  "auction.bid_outbid": {
    names: ["lot.code"],
    load: async (db, { payload }) => {
      const [row] = await db
        .select({ code: auctionLot.lotCode })
        .from(auctionBid)
        .innerJoin(auctionLot, eq(auctionBid.lotId, auctionLot.id))
        .where(eq(auctionBid.id, payload.previousBidId));
      if (!row) return {};
      return { "lot.code": row.code };
    },
  },
  "auction.lot_cancelled": { names: [], load: async () => ({}) },
  "artwork.retain_unrequested": { names: [], load: async () => ({}) },
  "entry.foa_verified": {
    names: VERIFICATION_VARIABLES,
    load: (db, { payload }) => verificationValues(db, payload.verificationId),
  },
  "entry.sent_back": {
    names: VERIFICATION_VARIABLES,
    load: (db, { payload }) => verificationValues(db, payload.verificationId),
  },
  "entry.submitted": {
    names: ENTRY_RECEIPT_VARIABLES,
    load: (db, { payload }) => entryValues(db, payload, true),
  },
  "entry.file_rejected": {
    names: ENTRY_ATTEMPT_VARIABLES,
    load: (db, { payload }) => entryValues(db, payload),
  },
  "entry.file_failed": {
    names: ENTRY_ATTEMPT_VARIABLES,
    load: (db, { payload }) => entryValues(db, payload),
  },
  "competition.school_judging_started": { names: [], load: async () => ({}) },
  "school_round.shortlist_finalised": { names: [], load: async () => ({}) },
  "school_round.closed_on_behalf": { names: [], load: async () => ({}) },
  "school_round.overdue": {
    names: SCHOOL_ROUND_OVERDUE_VARIABLES,
    load: (db, { payload }) => overdueValues(db, payload.roundId),
  },
  "entry.school_shortlisted": {
    names: SCHOOL_ROUND_OUTCOME_VARIABLES,
    load: (db, { payload }) => outcomeValues(db, payload),
  },
  "registration.not_shortlisted": {
    names: CONFIRMATION_VARIABLES,
    load: (db, { payload }) => confirmationValues(db, payload.registrationId),
  },
  "entry.not_shortlisted": {
    names: SCHOOL_ROUND_OUTCOME_VARIABLES,
    load: (db, { payload }) => outcomeValues(db, payload),
  },
  "privacy_request.submitted": {
    names: REQUEST_VARIABLES,
    load: (db, { payload }) => requestValues(db, payload.requestId),
  },
  "privacy_request.rejected": {
    names: REQUEST_VARIABLES,
    load: (db, { payload }) => requestValues(db, payload.requestId),
  },
  "privacy_request.completed": {
    names: REQUEST_VARIABLES,
    load: (db, { payload }) => requestValues(db, payload.requestId),
  },
  "privacy_request.overdue_digest": {
    names: DIGEST_VARIABLES,
    load: async (_db, { payload }) => digestValues(payload),
  },
  "privacy_request.export_requested": { names: [], load: async () => ({}) },
  "privacy_request.export_expired": { names: [], load: async () => ({}) },
  "privacy_request.erasure_approved": { names: [], load: async () => ({}) },
  "competition.announcement_sent": {
    names: ANNOUNCEMENT_VARIABLES,
    load: async (db, { payload }, cipher) =>
      (await announcementMessageFor({ db, cipher }, payload))?.values ?? {},
  },
  "volunteer.guardian_approval_requested": {
    names: APPLICATION_VARIABLES,
    load: (db, { payload }, cipher) =>
      applicationValues(db, payload.applicationId, cipher),
  },
  "volunteer.application_submitted": {
    names: APPLICATION_VARIABLES,
    load: (db, { payload }, cipher) =>
      applicationValues(db, payload.applicationId, cipher),
  },
  "volunteer.application_approved": {
    names: APPLICATION_VARIABLES,
    load: (db, { payload }, cipher) =>
      applicationValues(db, payload.applicationId, cipher),
  },
  "volunteer.application_declined": {
    names: DECLINED_VARIABLES,
    load: (db, { payload }, cipher) =>
      applicationValues(db, payload.applicationId, cipher),
  },
  "campaign.message_due": {
    names: CAMPAIGN_VARIABLES,
    load: (db, { payload }) => campaignEventValues(db, payload.campaignId),
  },
  "adoption.application_submitted": {
    names: ADOPTION_APPLICATION_VARIABLES,
    load: (db, { payload }) =>
      adoptionApplicationValues(db, payload.applicationId),
  },
  "adoption.application_under_review": {
    names: ADOPTION_APPLICATION_VARIABLES,
    load: (db, { payload }) =>
      adoptionApplicationValues(db, payload.applicationId),
  },
  "adoption.application_in_contact": {
    names: ADOPTION_APPLICATION_VARIABLES,
    load: (db, { payload }) =>
      adoptionApplicationValues(db, payload.applicationId),
  },
  "adoption.application_adopted": {
    names: ADOPTION_APPLICATION_VARIABLES,
    load: (db, { payload }) =>
      adoptionApplicationValues(db, payload.applicationId),
  },
  "adoption.application_not_matched": {
    names: ADOPTION_APPLICATION_VARIABLES,
    load: (db, { payload }) =>
      adoptionApplicationValues(db, payload.applicationId),
  },
  "adoption.application_declined": {
    names: ADOPTION_APPLICATION_VARIABLES,
    load: (db, { payload }) =>
      adoptionApplicationValues(db, payload.applicationId),
  },
  "adoption.application_withdrawn": {
    names: ADOPTION_APPLICATION_VARIABLES,
    load: (db, { payload }) =>
      adoptionApplicationValues(db, payload.applicationId),
  },
  "adoption.application_listing_closed": {
    names: ADOPTION_APPLICATION_VARIABLES,
    load: (db, { payload }) =>
      adoptionApplicationValues(db, payload.applicationId),
  },
};

/** The variables a template on a route for `eventType` may use. */
export function variablesFor(eventType: EventType): string[] {
  return [...RECIPIENT_VARIABLES, ...EVENT_VARIABLES[eventType].names];
}
