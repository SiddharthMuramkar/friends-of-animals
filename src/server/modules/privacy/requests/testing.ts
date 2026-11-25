// Shared set-up for the privacy request tests (#115). Test code only;
// nothing in the app imports it.

import { asc } from "drizzle-orm";

import type { Actor } from "@/server/actor";
import { privacyRequest } from "@/server/db/schema";
import type { Harness } from "@/test/harness";

/** Every privacy request row, oldest first. */
export async function requestRows(h: Harness) {
  return h.db.select().from(privacyRequest).orderBy(asc(privacyRequest.id));
}

/**
 * A signed-in grievance officer who has passed the second factor, as the
 * staff gate needs.
 */
export async function signedInOfficer(
  h: Harness,
  details: { name?: string; email?: string } = {}
): Promise<{ id: string; actor: Actor }> {
  const account = await h.seed.member({
    name: details.name ?? "Gita Officer",
    email: details.email ?? `officer-${crypto.randomUUID()}@example.test`,
  });
  await h.seed.grant(account, {
    role: "grievance_officer",
    scope: { type: "global" },
  });
  return { id: account.id, actor: await h.signIn(account) };
}

/** A member who has filed one request about themselves. */
export async function memberWithRequest(
  h: Harness,
  type: "access" | "correction" | "erasure" = "access",
  details: { name?: string; email?: string } = {}
) {
  const account = await h.seed.member(details);
  const actor = await h.signIn(account);
  const result = await h.as(actor).submitPrivacyRequest({
    type,
    subject: { kind: "self" },
    ...(type === "correction"
      ? { correctionDetails: "Please spell my name correctly" }
      : {}),
  });
  if (!result.ok) throw new Error(`Filing failed: ${result.error}`);
  return { account, actor, ...result };
}
