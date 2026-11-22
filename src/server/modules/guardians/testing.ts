// Shared set-up for the guardians module's Seam 1 tests: a member who
// declares and verifies through the real use cases, and dates of birth
// counted back from the harness clock on India's calendar. Test code only;
// nothing in the app imports it.

import type { Actor } from "@/server/actor";
import type { VerifiedAccount } from "@/server/identity/verified-account";
import { formatIsoDate } from "@/server/modules/registration/domain/calendar-date";
import { bornYearsAgo as birthDateYearsAgo } from "@/server/seed/guardians";
import type { Harness } from "@/test/harness";

/**
 * A signed-in member who has declared and verified as a guardian, through
 * registerAsGuardian and the emailed code.
 */
export async function verifiedGuardian(
  h: Harness,
  details: { name: string; email: string }
): Promise<{ account: VerifiedAccount; actor: Actor }> {
  const account = await h.seed.member(details);
  const actor = await h.signIn(account);
  const declared = await h
    .as(actor)
    .registerAsGuardian({ fullName: details.name, adultDeclared: true });
  if (!declared.ok) throw new Error(`Declaring failed: ${declared.error}`);
  const sent = await h.as(actor).startGuardianVerification();
  if (!sent.ok) throw new Error(`No code: ${sent.error}`);
  const code = h.email.codeFor(account.email);
  if (!code) throw new Error("No guardian code was emailed");
  const verified = await h.as(actor).confirmGuardianVerification({ code });
  if (!verified.ok) throw new Error(`Verifying failed: ${verified.error}`);
  return { account, actor };
}

/**
 * The date of birth, as `YYYY-MM-DD`, of someone who is `years` old today
 * in India at the harness clock, `days` after their birthday (negative:
 * before it).
 */
export function bornYearsAgo(h: Harness, years: number, days = 0): string {
  return formatIsoDate(birthDateYearsAgo(h.clock.now(), years, days));
}
