// The adoption application's state machine. An FOA adoption coordinator
// moves an application through review, contact and outcome; the applicant
// may withdraw it while it is open; when the animal is adopted or its
// listing is withdrawn, every other open application closes. The listing
// owner only reads and is told: they never move the status.
//
// Pure: the use case loads the application, the actor's role and the
// applicant's contact-sharing consent, asks here, then writes the new
// status, the audit row and the event in one transaction. Loads under
// plain Node (the schema builds its enum from the status list).

export const ADOPTION_APPLICATION_STATUSES = [
  "submitted",
  "under_review",
  "in_contact",
  "adopted",
  "not_matched",
  "declined",
  "withdrawn",
  "listing_closed",
] as const;

export type AdoptionApplicationStatus =
  (typeof ADOPTION_APPLICATION_STATUSES)[number];

/** Statuses that still wait on someone. One applicant has at most one per listing. */
export const OPEN_APPLICATION_STATUSES = [
  "submitted",
  "under_review",
  "in_contact",
] as const satisfies readonly AdoptionApplicationStatus[];

export type OpenApplicationStatus = (typeof OPEN_APPLICATION_STATUSES)[number];

const OPEN: ReadonlySet<AdoptionApplicationStatus> = new Set(
  OPEN_APPLICATION_STATUSES
);

export function isOpenApplication(
  status: AdoptionApplicationStatus
): status is OpenApplicationStatus {
  return OPEN.has(status);
}

/**
 * Whether the listing owner may see the applicant's phone, address and
 * answers. Only once the coordinator has put them in touch, and not after
 * the match ended without an adoption: the share itself stays in the audit
 * log.
 */
export function ownerSeesApplicantContact(
  status: AdoptionApplicationStatus
): boolean {
  return status === "in_contact" || status === "adopted";
}

/** Who is acting, as the use case worked it out from the actor's grants. */
export type ApplicationActor = "coordinator" | "applicant" | "system";

/** Why the listing closed under an open application. */
export type ListingClosureCause = "adopted_elsewhere" | "listing_withdrawn";

export type ApplicationOutcome = "adopted" | "not_matched" | "declined";

export type ApplicationAction =
  | { kind: "start_review" }
  | { kind: "put_in_contact" }
  | { kind: "record_outcome"; outcome: ApplicationOutcome; reason?: string }
  | { kind: "withdraw"; reason?: string }
  | { kind: "close_for_listing"; cause: ListingClosureCause };

/** Whether the applicant currently agrees to their contact being shared. */
export type SharingConsentState = "given" | "withdrawn" | "none";

export type ApplicationRecipient = "applicant" | "listing_owner";

export type ApplicationTransitionRefusal =
  /** This actor never takes this action. */
  | "forbidden_actor"
  /** The action doesn't apply to an application in this status. */
  | "invalid_transition"
  /** Not matched and declined need a reason for the record. */
  | "reason_required"
  | "reason_too_long"
  /** The applicant no longer agrees to their contact being shared. */
  | "sharing_consent_missing";

export type ApplicationTransition = {
  ok: true;
  to: AdoptionApplicationStatus;
  /** Stored as `outcome_reason`; staff-facing, never sent verbatim. */
  reason: string | null;
  /** The applicant's contact goes to the listing owner: audit the share. */
  sharesContact: boolean;
  /** The listing becomes adopted and its other open applications close. */
  closesListing: boolean;
  event: "adoption.adopted" | "adoption.application_status_changed";
  notify: readonly ApplicationRecipient[];
};

export type ApplicationTransitionDecision =
  | ApplicationTransition
  | { ok: false; reason: ApplicationTransitionRefusal };

/** Longest reason kept for the record. */
export const MAX_REASON_LENGTH = 1000;

type Rule = {
  actor: ApplicationActor;
  from: readonly AdoptionApplicationStatus[];
  to: AdoptionApplicationStatus;
  reason: "required" | "optional" | "none";
};

const BOTH: readonly ApplicationRecipient[] = ["applicant", "listing_owner"];

function outcomeRule(outcome: ApplicationOutcome): Rule {
  switch (outcome) {
    case "adopted":
      return {
        actor: "coordinator",
        from: ["in_contact"],
        to: "adopted",
        reason: "none",
      };
    case "not_matched":
      return {
        actor: "coordinator",
        from: ["under_review", "in_contact"],
        to: "not_matched",
        reason: "required",
      };
    case "declined":
      return {
        actor: "coordinator",
        from: OPEN_APPLICATION_STATUSES,
        to: "declined",
        reason: "required",
      };
  }
}

function ruleFor(action: ApplicationAction): Rule {
  switch (action.kind) {
    case "start_review":
      return {
        actor: "coordinator",
        from: ["submitted"],
        to: "under_review",
        reason: "none",
      };
    case "put_in_contact":
      return {
        actor: "coordinator",
        from: ["under_review"],
        to: "in_contact",
        reason: "none",
      };
    case "record_outcome":
      return outcomeRule(action.outcome);
    case "withdraw":
      return {
        actor: "applicant",
        from: OPEN_APPLICATION_STATUSES,
        to: "withdrawn",
        reason: "optional",
      };
    case "close_for_listing":
      return {
        actor: "system",
        from: OPEN_APPLICATION_STATUSES,
        to: "listing_closed",
        reason: "none",
      };
  }
}

function givenReason(action: ApplicationAction): string | undefined {
  return action.kind === "record_outcome" || action.kind === "withdraw"
    ? action.reason
    : undefined;
}

/**
 * Decides one move of an adoption application: refused, or the new status
 * with what the use case must also do (store a reason, audit a contact
 * share, close the listing, emit an event, tell people).
 */
export function decideApplicationTransition(input: {
  from: AdoptionApplicationStatus;
  action: ApplicationAction;
  actor: ApplicationActor;
  sharingConsent: SharingConsentState;
}): ApplicationTransitionDecision {
  const { from, action, actor, sharingConsent } = input;
  const rule = ruleFor(action);
  if (actor !== rule.actor) return { ok: false, reason: "forbidden_actor" };
  if (!rule.from.includes(from)) {
    return { ok: false, reason: "invalid_transition" };
  }

  let reason: string | null = null;
  if (action.kind === "close_for_listing") {
    reason = action.cause;
  } else if (rule.reason !== "none") {
    const trimmed = givenReason(action)?.trim() ?? "";
    if (trimmed === "" && rule.reason === "required") {
      return { ok: false, reason: "reason_required" };
    }
    if (trimmed.length > MAX_REASON_LENGTH) {
      return { ok: false, reason: "reason_too_long" };
    }
    reason = trimmed === "" ? null : trimmed;
  }

  const sharesContact = action.kind === "put_in_contact";
  if (sharesContact && sharingConsent !== "given") {
    return { ok: false, reason: "sharing_consent_missing" };
  }

  const closesListing = rule.to === "adopted";
  return {
    ok: true,
    to: rule.to,
    reason,
    sharesContact,
    closesListing,
    event: closesListing
      ? "adoption.adopted"
      : "adoption.application_status_changed",
    // The owner closed or adopted the listing themselves: only applicants
    // need telling.
    notify: action.kind === "close_for_listing" ? ["applicant"] : BOTH,
  };
}

export type PlannedClosure = {
  id: string;
  from: OpenApplicationStatus;
  to: "listing_closed";
  reason: ListingClosureCause;
};

/**
 * The applications to close when a listing closes: every one still open.
 * The adopted application itself is no longer open, so it is never in the
 * plan.
 */
export function planListingClosure(input: {
  cause: ListingClosureCause;
  applications: readonly { id: string; status: AdoptionApplicationStatus }[];
}): PlannedClosure[] {
  const plan: PlannedClosure[] = [];
  for (const application of input.applications) {
    if (!isOpenApplication(application.status)) continue;
    const decision = decideApplicationTransition({
      from: application.status,
      action: { kind: "close_for_listing", cause: input.cause },
      actor: "system",
      sharingConsent: "none",
    });
    if (decision.ok) {
      plan.push({
        id: application.id,
        from: application.status,
        to: "listing_closed",
        reason: input.cause,
      });
    }
  }
  return plan;
}
