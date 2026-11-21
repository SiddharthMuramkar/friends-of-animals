// The life of a privacy rights request (#115). A data principal, or a
// guardian for their child, files an access, correction or erasure request;
// the grievance officer starts or assigns it, then completes or rejects it.
// The requester may cancel only before work starts. An erasure that had to
// keep some categories (financial records, a legal hold) ends as
// `partially_completed`. Closed requests never change again.
//
// Pure, and loads under plain Node: the schema builds its enums from these
// lists, so they can't drift.

export const PRIVACY_REQUEST_TYPES = [
  "access",
  "correction",
  "erasure",
] as const;

export type PrivacyRequestType = (typeof PRIVACY_REQUEST_TYPES)[number];

export const PRIVACY_REQUEST_STATUSES = [
  "submitted",
  "in_progress",
  "completed",
  "partially_completed",
  "rejected",
  "cancelled",
] as const;

export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUSES)[number];

/** What a new request starts as. */
export const INITIAL_REQUEST_STATUS: PrivacyRequestStatus = "submitted";

export const REQUEST_EVENTS = [
  /** The grievance officer takes the request themselves. */
  "start",
  /** The grievance officer gives it to an officer (themselves or another). */
  "assign",
  /** The requester withdraws it. */
  "cancel",
  /** The officer refuses it, with a reason the requester sees. */
  "reject",
  /** Done in full. */
  "complete",
  /** An erasure done except for categories the law or a hold keeps. */
  "complete_with_retained",
] as const;

export type RequestEvent = (typeof REQUEST_EVENTS)[number];

export type RequestTransitionRefusal =
  | "request_closed"
  | "already_started"
  | "already_in_progress"
  | "not_started"
  | "not_erasure";

export type RequestTransition =
  | { ok: true; to: PrivacyRequestStatus }
  | { ok: false; reason: RequestTransitionRefusal };

const OPEN: ReadonlySet<PrivacyRequestStatus> = new Set([
  "submitted",
  "in_progress",
]);

/** Whether the request still waits for the grievance officer. */
export function isOpenRequest(status: PrivacyRequestStatus): boolean {
  return OPEN.has(status);
}

function to(status: PrivacyRequestStatus): RequestTransition {
  return { ok: true, to: status };
}

function no(reason: RequestTransitionRefusal): RequestTransition {
  return { ok: false, reason };
}

/** Where `event` takes a request of `type` that is at `from`, if anywhere. */
export function decideRequestTransition(input: {
  from: PrivacyRequestStatus;
  event: RequestEvent;
  type: PrivacyRequestType;
}): RequestTransition {
  const { from, event, type } = input;
  if (!isOpenRequest(from)) return no("request_closed");
  const started = from === "in_progress";
  switch (event) {
    case "start":
      return started ? no("already_started") : to("in_progress");
    case "assign":
      return to("in_progress");
    case "cancel":
      return started ? no("already_in_progress") : to("cancelled");
    case "reject":
      return to("rejected");
    case "complete":
      return started ? to("completed") : no("not_started");
    case "complete_with_retained":
      if (type !== "erasure") return no("not_erasure");
      return started ? to("partially_completed") : no("not_started");
  }
}
