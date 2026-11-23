// The life of a guardian consent link (#83). A coordinator sends a link to
// the guardian contact the school holds; the guardian opens it, asks for a
// one-time code to that same contact, enters it, and then has a short
// window to give or decline each public use. One answer uses the link up.
//
// The database stores pending, used or revoked. "Expired" is never stored
// but read from `expiresAt` against the clock, so no job flips rows and the
// link stops working at the exact instant. The one-time code, its attempts
// and the answer window live on the link row, so a guardian needs no
// account and nothing else holds state.
//
// Pure: no database, no clock of its own. Loads under plain Node (the seed
// script), so relative imports only and no "server-only".

const MINUTE_MS = 60 * 1000;

/** How long a link works after it is sent: seven days. */
export const LINK_TTL_MS = 7 * 24 * 60 * MINUTE_MS;
/** How long one emailed or texted code works. */
export const CODE_TTL_MS = 10 * MINUTE_MS;
/** Wrong guesses allowed on one code before it stops working. */
export const CODE_MAX_ATTEMPTS = 5;
/** The shortest gap between two codes for one link. */
export const CODE_RESEND_COOLDOWN_MS = MINUTE_MS;
/** Codes one link may send in its life; then the school sends a new link. */
export const CODE_MAX_SENDS = 5;
/** How long a verified guardian has to answer before verifying again. */
export const ANSWER_WINDOW_MS = 30 * MINUTE_MS;

/** What the `consent_link_status` column holds. */
export type StoredLinkStatus = "pending" | "used" | "revoked";

/** The parts of a link its life depends on, as the row stores them. */
export type LinkState = {
  status: StoredLinkStatus;
  expiresAt: Date;
  /** Codes sent so far for this link. */
  codesSent: number;
  lastCodeSentAt: Date | null;
  /** When the current code stops working; null before the first code. */
  codeExpiresAt: Date | null;
  /** Wrong guesses on the current code. */
  codeAttempts: number;
  /** When the guardian last entered a right code; null before that. */
  verifiedAt: Date | null;
};

/** What the coordinator dashboard shows about a link at an instant. */
export type LinkStatus =
  | "sent"
  | "opened"
  | "verified"
  | "answered"
  | "expired"
  | "revoked";

/** Refusals every step shares, in the order they are checked. */
export type ClosedLinkReason = "already_used" | "revoked" | "expired";

export type SendCodeDecision =
  | {
      ok: true;
      /** Store these on the link with the new code's hash. */
      patch: Pick<LinkState, "codesSent" | "codeAttempts" | "verifiedAt"> & {
        lastCodeSentAt: Date;
        codeExpiresAt: Date;
      };
    }
  | { ok: false; reason: ClosedLinkReason | "too_many_codes" }
  | { ok: false; reason: "wait"; retryAt: Date };

export type VerifyCodeDecision =
  | {
      ok: true;
      /** Store with the new answer-session hash; the code is spent. */
      patch: Pick<LinkState, "verifiedAt" | "codeExpiresAt" | "codeAttempts">;
      answerBy: Date;
    }
  | {
      ok: false;
      reason: ClosedLinkReason | "no_code" | "code_expired" | "code_locked";
    }
  | {
      ok: false;
      reason: "wrong_code";
      attemptsLeft: number;
      /** Store this even though the step failed. */
      patch: Pick<LinkState, "codeAttempts">;
    };

export type AnswerDecision =
  | { ok: true; patch: { status: "used"; usedAt: Date } }
  | { ok: false; reason: ClosedLinkReason | "not_verified" | "window_closed" };

export type RevokeDecision =
  | { ok: true; patch: { status: "revoked"; revokedAt: Date } }
  | { ok: false; reason: "already_used" | "revoked" };

const after = (instant: Date, ms: number) => new Date(instant.getTime() + ms);
const reached = (now: Date, instant: Date) =>
  now.getTime() >= instant.getTime();

/** When a link sent at `sentAt` stops working. */
export function linkExpiresAt(sentAt: Date, ttlMs: number = LINK_TTL_MS): Date {
  return after(sentAt, ttlMs);
}

/** Why the link can no longer be used at `now`, if it can't. */
export function closedReason(
  link: Pick<LinkState, "status" | "expiresAt">,
  now: Date
): ClosedLinkReason | null {
  if (link.status === "used") return "already_used";
  if (link.status === "revoked") return "revoked";
  if (reached(now, link.expiresAt)) return "expired";
  return null;
}

/** Whether a verified guardian may still answer at `now`. */
function inAnswerWindow(
  link: Pick<LinkState, "verifiedAt" | "expiresAt">,
  now: Date
): boolean {
  return (
    link.verifiedAt !== null &&
    !reached(now, answerDeadline(link.verifiedAt, link.expiresAt))
  );
}

/** The answer window ends with the link or 30 minutes after verification. */
export function answerDeadline(verifiedAt: Date, expiresAt: Date): Date {
  return new Date(
    Math.min(verifiedAt.getTime() + ANSWER_WINDOW_MS, expiresAt.getTime())
  );
}

/** The link's status at `now`, for the dashboard and the public page. */
export function linkStatus(
  link: Pick<LinkState, "status" | "expiresAt" | "codesSent" | "verifiedAt">,
  now: Date
): LinkStatus {
  const closed = closedReason(link, now);
  if (closed === "already_used") return "answered";
  if (closed !== null) return closed;
  if (inAnswerWindow(link, now)) return "verified";
  return link.codesSent > 0 ? "opened" : "sent";
}

/**
 * Whether a new code may go to the guardian contact now. A new code
 * replaces the old one, resets its attempts and ends any answer window, so
 * whoever answers has just proved they read the contact.
 */
export function decideSendCode(link: LinkState, now: Date): SendCodeDecision {
  const closed = closedReason(link, now);
  if (closed) return { ok: false, reason: closed };
  if (link.codesSent >= CODE_MAX_SENDS) {
    return { ok: false, reason: "too_many_codes" };
  }
  if (link.lastCodeSentAt) {
    const retryAt = after(link.lastCodeSentAt, CODE_RESEND_COOLDOWN_MS);
    if (!reached(now, retryAt)) return { ok: false, reason: "wait", retryAt };
  }
  return {
    ok: true,
    patch: {
      codesSent: link.codesSent + 1,
      lastCodeSentAt: now,
      codeExpiresAt: new Date(
        Math.min(now.getTime() + CODE_TTL_MS, link.expiresAt.getTime())
      ),
      codeAttempts: 0,
      verifiedAt: null,
    },
  };
}

/**
 * The outcome of entering a code. `codeMatches` is the constant-time
 * comparison of the entered code with the stored hash; it is ignored once
 * the code is spent, expired or locked, so no guess is ever checked late.
 */
export function decideVerifyCode(
  link: LinkState,
  now: Date,
  codeMatches: boolean
): VerifyCodeDecision {
  const closed = closedReason(link, now);
  if (closed) return { ok: false, reason: closed };
  if (link.codeExpiresAt === null) return { ok: false, reason: "no_code" };
  if (link.codeAttempts >= CODE_MAX_ATTEMPTS) {
    return { ok: false, reason: "code_locked" };
  }
  if (reached(now, link.codeExpiresAt)) {
    return { ok: false, reason: "code_expired" };
  }
  if (!codeMatches) {
    const codeAttempts = link.codeAttempts + 1;
    return {
      ok: false,
      reason: "wrong_code",
      attemptsLeft: CODE_MAX_ATTEMPTS - codeAttempts,
      patch: { codeAttempts },
    };
  }
  return {
    ok: true,
    // A right code is spent at once: it can't verify a second session.
    patch: { verifiedAt: now, codeExpiresAt: now, codeAttempts: 0 },
    answerBy: answerDeadline(now, link.expiresAt),
  };
}

/**
 * Whether the guardian's answers may be recorded now. `sessionMatches` is
 * whether the request carries the answer-session secret minted at
 * verification, so a forwarded link alone can't answer.
 */
export function decideAnswer(
  link: LinkState,
  now: Date,
  sessionMatches: boolean
): AnswerDecision {
  const closed = closedReason(link, now);
  if (closed) return { ok: false, reason: closed };
  if (link.verifiedAt === null || !sessionMatches) {
    return { ok: false, reason: "not_verified" };
  }
  if (!inAnswerWindow(link, now)) return { ok: false, reason: "window_closed" };
  return { ok: true, patch: { status: "used", usedAt: now } };
}

/**
 * Whether the coordinator may withdraw the link, also done when a new link
 * replaces it. Works on a pending link, expired or not.
 */
export function decideRevoke(
  link: Pick<LinkState, "status">,
  now: Date
): RevokeDecision {
  if (link.status === "used") return { ok: false, reason: "already_used" };
  if (link.status === "revoked") return { ok: false, reason: "revoked" };
  return { ok: true, patch: { status: "revoked", revokedAt: now } };
}
