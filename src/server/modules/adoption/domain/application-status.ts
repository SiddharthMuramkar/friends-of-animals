// An adoption application's states and the moves between them (#130).
//
// FOA facilitates adoption; it doesn't run a shelter. So one actor moves an
// application on: the adoption coordinator reviews it, puts the applicant
// in touch with the listing organisation, and records the outcome. The
// applicant may withdraw while it is open. The platform closes every open
// application on an animal once it is adopted through another application
// or its listing is withdrawn. The listing organisation's representatives
// only read (and, from `in_contact`, see the applicant's contact details).
//
// How an application starts is decided in ./application-eligibility.ts;
// this table covers what happens after it exists. Closed statuses never
// reopen: the person applies again instead.
//
// Pure: loads under plain Node, so the schema can build its pgEnum from
// ADOPTION_APPLICATION_STATUSES.

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

/**
 * Statuses still waiting on someone. A person has at most one open
 * application per animal: the schema's partial unique index uses this list.
 */
export const OPEN_ADOPTION_APPLICATION_STATUSES = [
  "submitted",
  "under_review",
  "in_contact",
] as const satisfies readonly AdoptionApplicationStatus[];

export function isOpenAdoptionApplication(
  status: AdoptionApplicationStatus
): boolean {
  return (OPEN_ADOPTION_APPLICATION_STATUSES as readonly string[]).includes(
    status
  );
}

/** What can happen to an application. */
export const ADOPTION_APPLICATION_ACTIONS = [
  /** The coordinator starts reading it. */
  "start_review",
  /** The coordinator shares the applicant's contact with the organisation. */
  "put_in_contact",
  /** The coordinator records that the applicant adopted the animal. */
  "record_adopted",
  /** The coordinator records that the match didn't work out, with a reason. */
  "record_not_matched",
  /** The coordinator won't take it forward, with a reason. */
  "decline",
  /** The applicant takes it back. */
  "withdraw",
  /** The animal was adopted by someone else, or its listing withdrawn. */
  "close_listing",
] as const;

export type AdoptionApplicationAction =
  (typeof ADOPTION_APPLICATION_ACTIONS)[number];

export type AdoptionApplicationActor = "coordinator" | "applicant" | "system";

type Move = {
  from: readonly AdoptionApplicationStatus[];
  to: AdoptionApplicationStatus;
  by: AdoptionApplicationActor;
  /** The coordinator must say why (kept for staff; never sent verbatim). */
  needsReason?: true;
};

/** Every allowed move; anything else is refused. */
export const ADOPTION_APPLICATION_MOVES: Readonly<
  Record<AdoptionApplicationAction, Move>
> = {
  start_review: { from: ["submitted"], to: "under_review", by: "coordinator" },
  put_in_contact: {
    from: ["under_review"],
    to: "in_contact",
    by: "coordinator",
  },
  record_adopted: { from: ["in_contact"], to: "adopted", by: "coordinator" },
  record_not_matched: {
    from: ["under_review", "in_contact"],
    to: "not_matched",
    by: "coordinator",
    needsReason: true,
  },
  decline: {
    from: ["submitted", "under_review", "in_contact"],
    to: "declined",
    by: "coordinator",
    needsReason: true,
  },
  withdraw: {
    from: OPEN_ADOPTION_APPLICATION_STATUSES,
    to: "withdrawn",
    by: "applicant",
  },
  close_listing: {
    from: OPEN_ADOPTION_APPLICATION_STATUSES,
    to: "listing_closed",
    by: "system",
  },
};

/** The longest reason a coordinator may give. */
export const OUTCOME_REASON_MAX_LENGTH = 1000;

export type AdoptionApplicationTransitionInput = {
  from: AdoptionApplicationStatus;
  action: AdoptionApplicationAction;
  actor: AdoptionApplicationActor;
  reason?: string | null;
};

export type AdoptionApplicationTransitionRefusal =
  | "forbidden_actor"
  | "invalid_transition"
  | "reason_required"
  | "reason_too_long";

export type AdoptionApplicationTransition =
  | {
      ok: true;
      to: AdoptionApplicationStatus;
      /** The trimmed reason, for not_matched and declined; else null. */
      reason: string | null;
      /** The listing organisation sees the applicant's contact from now. */
      sharesContact: boolean;
      /** The animal is adopted: its listing closes, and its other applications. */
      closesListing: boolean;
    }
  | { ok: false; reason: AdoptionApplicationTransitionRefusal };

/** Decides one move: who may make it, from where, and with what reason. */
export function decideAdoptionApplicationTransition({
  from,
  action,
  actor,
  reason,
}: AdoptionApplicationTransitionInput): AdoptionApplicationTransition {
  const move = ADOPTION_APPLICATION_MOVES[action];
  if (move.by !== actor) return { ok: false, reason: "forbidden_actor" };
  if (!move.from.includes(from)) {
    return { ok: false, reason: "invalid_transition" };
  }
  let kept: string | null = null;
  if (move.needsReason) {
    kept = reason?.trim() ?? "";
    if (kept === "") return { ok: false, reason: "reason_required" };
    if (kept.length > OUTCOME_REASON_MAX_LENGTH) {
      return { ok: false, reason: "reason_too_long" };
    }
  }
  return {
    ok: true,
    to: move.to,
    reason: kept,
    sharesContact: move.to === "in_contact",
    closesListing: move.to === "adopted",
  };
}

/**
 * Whether the listing organisation sees the applicant's phone, address and
 * answers: only once the coordinator has put them in touch, and after the
 * adoption. Before that, and after any other ending, it sees the status.
 */
export function ownerSeesApplicantContact(
  status: AdoptionApplicationStatus
): boolean {
  return status === "in_contact" || status === "adopted";
}
