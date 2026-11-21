// Leaving a campaign's audience. Every campaign message carries two ways
// out, both built on one link token per delivery:
//
//   - a link in the message to `/unsubscribe/<token>`, a page that asks
//     before it withdraws anything. Mail scanners open links, so a GET
//     never withdraws;
//   - the one-click headers of RFC 8058, which mail apps POST to
//     `/api/unsubscribe/<token>` with the body `List-Unsubscribe=One-Click`.
//
// Unsubscribing withdraws every consent the message rested on that is
// still given: the recipient's own consent to news, and the communications
// consent of each child it was about. Withdrawing more than one campaign's
// worth is the safe side; consent can always be given again.
//
// Pure: loads under plain Node, relative imports only.

import type { ConsentStatus } from "./audience-plan";

/** The value of `List-Unsubscribe-Post`, and the body mail apps POST. */
export const ONE_CLICK_BODY = "List-Unsubscribe=One-Click";

/** Characters a link token may hold: base64url, so it needs no escaping. */
const URL_SAFE_TOKEN = /^[A-Za-z0-9_-]+$/;

const LOCAL_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
]);

/**
 * The page and one-click links for one delivery's token, on `siteUrl`
 * (the site's origin; a path on it is ignored).
 */
export function unsubscribeLinks(
  siteUrl: string,
  token: string
): { page: string; oneClick: string } {
  if (!URL_SAFE_TOKEN.test(token)) {
    throw new RangeError("An unsubscribe token must be base64url");
  }
  const origin = new URL(siteUrl);
  if (origin.protocol !== "https:" && origin.protocol !== "http:") {
    throw new RangeError("The site URL must be http or https");
  }
  return {
    page: new URL(`/unsubscribe/${token}`, origin).href,
    oneClick: new URL(`/api/unsubscribe/${token}`, origin).href,
  };
}

/**
 * The RFC 8058 headers for a one-click link. The RFC requires HTTPS; plain
 * HTTP is allowed only for a local run, whose mail is captured, not sent.
 */
export function listUnsubscribeHeaders(
  oneClickUrl: string
): Readonly<Record<"List-Unsubscribe" | "List-Unsubscribe-Post", string>> {
  const url = new URL(oneClickUrl);
  const local = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !local) {
    throw new RangeError("A one-click unsubscribe link must use HTTPS");
  }
  return {
    "List-Unsubscribe": `<${url.href}>`,
    "List-Unsubscribe-Post": ONE_CLICK_BODY,
  };
}

/**
 * Whether a POSTed form is an RFC 8058 one-click request. Takes the parsed
 * body (`FormData` or `URLSearchParams`), urlencoded or multipart alike.
 */
export function isOneClickUnsubscribe(form: {
  getAll(name: string): unknown[];
}): boolean {
  return form.getAll("List-Unsubscribe").includes("One-Click");
}

/** One consent a delivery rested on, with its state now. */
export type UnsubscribeBasis =
  | { purpose: "messages"; subjectUserId: string; current: ConsentStatus }
  | {
      purpose: "communications";
      subjectProfileId: string;
      current: ConsentStatus;
    };

/** One consent to withdraw, in the consent module's terms. */
export type Withdrawal = {
  purpose: "messages" | "communications";
  subjectType: "user" | "participant_profile";
  subjectId: string;
};

/**
 * What unsubscribing withdraws: each basis still given, once. When nothing
 * is still given (the link was used before, or consent was withdrawn some
 * other way) nothing changes, and the page says it is already done.
 */
export function decideUnsubscribe(bases: readonly UnsubscribeBasis[]): {
  withdraw: Withdrawal[];
  changed: boolean;
} {
  const withdraw: Withdrawal[] = [];
  const seen = new Set<string>();
  for (const basis of bases) {
    if (basis.current.status !== "given") continue;
    const withdrawal: Withdrawal =
      basis.purpose === "messages"
        ? {
            purpose: "messages",
            subjectType: "user",
            subjectId: basis.subjectUserId,
          }
        : {
            purpose: "communications",
            subjectType: "participant_profile",
            subjectId: basis.subjectProfileId,
          };
    const key = `${withdrawal.purpose}:${withdrawal.subjectId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    withdraw.push(withdrawal);
  }
  return { withdraw, changed: withdraw.length > 0 };
}
