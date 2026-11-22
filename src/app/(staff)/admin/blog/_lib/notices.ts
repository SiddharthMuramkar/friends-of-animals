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
