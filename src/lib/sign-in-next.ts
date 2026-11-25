import { judgeInvitationNext } from "./judge-invitation-next";
import { safeNext } from "./second-factor-routes";

/** The sign-in flow only returns to recognised exact local routes. */
export function signInNext(raw: unknown): string | null {
  const next = safeNext(raw);
  return (
    judgeInvitationNext(next) ??
    (next === "/account/auctions" ? next : null) ??
    (next &&
    /^\/(?:account\/)?auctions\/LOT-\d{2}-[0-9A-HJKMNP-TV-Z]{5}$/.test(next)
      ? next
      : null)
  );
}
