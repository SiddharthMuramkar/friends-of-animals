// The contact message status machine (#113). A message from the contact
// form starts new. Staff take it on (assigning someone does that too),
// close it with a reason, and may reopen it. Nothing goes back to new, so
// "new" always means nobody has looked at it yet.
//
// Loads under plain Node (schema, seed script), so no "server-only" here.

/** In the order a message usually meets them. */
export const CONTACT_MESSAGE_STATUSES = [
  "new",
  "in_progress",
  "closed",
] as const;

export type ContactMessageStatus = (typeof CONTACT_MESSAGE_STATUSES)[number];

/** Why staff closed a message. Stored as a code, never free text. */
export const CONTACT_CLOSE_REASONS = [
  "resolved",
  "no_action_needed",
  "spam",
  "duplicate",
] as const;

export type ContactCloseReason = (typeof CONTACT_CLOSE_REASONS)[number];

/** Every allowed move. A target missing from a status is refused. */
const TRANSITIONS: Record<
  ContactMessageStatus,
  readonly ContactMessageStatus[]
> = {
  new: ["in_progress", "closed"],
  in_progress: ["closed"],
  closed: ["in_progress"],
};

export type ContactStatusChange =
  /** Already in that status: nothing to write or audit. */
  | { ok: true; changed: false }
  | {
      ok: true;
      changed: true;
      to: ContactMessageStatus;
      /** Set when closing, cleared (null) on any other move. */
      closeReason: ContactCloseReason | null;
    }
  | {
      ok: false;
      error:
        | "transition_not_allowed"
        | "close_reason_required"
        | "close_reason_not_allowed";
    };

/** Where moving a message from `from` to `to` lands, if it may. */
export function decideStatusChange(input: {
  from: ContactMessageStatus;
  to: ContactMessageStatus;
  closeReason?: ContactCloseReason | undefined;
}): ContactStatusChange {
  const { from, to, closeReason } = input;
  if (from === to) return { ok: true, changed: false };
  if (!TRANSITIONS[from].includes(to)) {
    return { ok: false, error: "transition_not_allowed" };
  }
  if (to === "closed") {
    if (closeReason === undefined) {
      return { ok: false, error: "close_reason_required" };
    }
    return { ok: true, changed: true, to, closeReason };
  }
  if (closeReason !== undefined) {
    return { ok: false, error: "close_reason_not_allowed" };
  }
  return { ok: true, changed: true, to, closeReason: null };
}

export type ContactAssignment =
  | { ok: true; changed: boolean; status: ContactMessageStatus }
  | { ok: false; error: "message_closed" };

/**
 * What assigning `to` (a user id, or null to unassign) does to a message.
 * Assigning someone to a new message takes it on; a closed message must be
 * reopened first. Whether `to` may handle the message's team is the use
 * case's check (`mayHandle` in ./routing.ts).
 */
export function decideAssignment(input: {
  status: ContactMessageStatus;
  assigneeId: string | null;
  to: string | null;
}): ContactAssignment {
  const { status, assigneeId, to } = input;
  if (status === "closed") return { ok: false, error: "message_closed" };
  if (to === assigneeId) return { ok: true, changed: false, status };
  return {
    ok: true,
    changed: true,
    status: to !== null && status === "new" ? "in_progress" : status,
  };
}
