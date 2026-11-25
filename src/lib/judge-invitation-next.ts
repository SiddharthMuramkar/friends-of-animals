// Only an exact local invitation link may continue the email code flow.
// No arbitrary next URL, query string or fragment can escape the site.
import { safeNext } from "./second-factor-routes";
export function judgeInvitationNext(raw: unknown): string | null {
  const next = safeNext(raw);
  return next && /^\/judge\/invitations\/[A-Za-z0-9_-]{43}$/.test(next)
    ? next
    : null;
}
