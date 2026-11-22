// What the post editor says after an action redirected back to it: what
// was done (`?notice=<kind>-<token>`) or why it wasn't (`&refused=<code>`).
// The token makes each redirect a new URL, so doing the same thing twice
// shows the notice twice. Pure, so the mapping is tested without a page.

export const NOTICE_KINDS = [
  "created",
  "saved",
  "scheduled",
  "unscheduled",
  "published",
  "archived",
  "restored",
  "described",
] as const;

export type NoticeKind = (typeof NOTICE_KINDS)[number];

export const REFUSAL_CODES = [
  "not_in_future",
  "invalid_instant",
  "invalid_transition",
  "image_not_ready",
  "invalid_input",
  "cover_alt_required",
  "too_long",
  "archived",
  "not_found",
  "failed",
] as const;

export type RefusalCode = (typeof REFUSAL_CODES)[number];

export type Notice = {
  kind: NoticeKind;
  /** Why it wasn't done, or null when it was. */
  refused: RefusalCode | null;
  /** New for each redirect: the notice's React key. */
  key: string;
};

/** A fresh value per redirect. */
function token(): string {
  return Date.now().toString(36);
}

/** The query string an action redirects back with. */
export function noticeQuery(kind: NoticeKind, refused?: RefusalCode): string {
  const query = new URLSearchParams({ notice: `${kind}-${token()}` });
  if (refused) query.set("refused", refused);
  return query.toString();
}

/** A use case's refusal: its code, and for invalid input, why by field. */
type Refused = {
  ok: false;
  error: string;
  fields?: string[];
  errors?: Partial<Record<string, string>>;
};

/**
 * A use case's refusal code as the editor's notice names it. A code the
 * notice doesn't know reads as "failed", never as done.
 */
export function refusalCode(error: string): RefusalCode {
  return REFUSAL_CODES.find((code) => code === error) ?? "failed";
}

/** Why an image's alt text wasn't saved, as the editor's notice names it. */
export function altRefusal(refused: Refused): RefusalCode {
  if (refused.error === "invalid_input") {
    if (refused.errors?.alt === "too_long") return "too_long";
    if (refused.errors?.coverAlt === "required") return "cover_alt_required";
    return "invalid_input";
  }
  return refusalCode(refused.error);
}

type Params = Record<string, string | string[] | undefined>;

/** The notice in the page's query, or null. */
export function noticeOf(params: Params): Notice | null {
  const { notice, refused } = params;
  if (typeof notice !== "string") return null;
  const match = /^([a-z]+)-[a-z0-9]+$/.exec(notice);
  const kind = NOTICE_KINDS.find((each) => each === match?.[1]);
  if (!kind) return null;
  return {
    kind,
    refused: REFUSAL_CODES.find((each) => each === refused) ?? null,
    key: notice,
  };
}
