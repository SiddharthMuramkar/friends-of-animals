// Shared set-up for the competitions module's Seam 1 tests: actors holding
// competition roles, and a competition manager's complete form. Test code
// only; nothing in the app imports it.

import type { Scope } from "@/server/access";
import type { Actor } from "@/server/actor";
import type { Harness } from "@/test/harness";

import type { CompetitionFields } from "./fields";

/** A signed-in competition manager, global unless `scope` says otherwise. */
export async function signInManager(
  h: Harness,
  scope: Scope = { type: "global" },
  meta?: { ip?: string; userAgent?: string }
): Promise<Actor> {
  const user = await h.seed.member();
  await h.seed.grant(user, { role: "competition_manager", scope });
  return h.signIn(user, meta);
}

/** A signed-in user holding exactly `role` globally, or no role at all. */
export async function signInWith(
  h: Harness,
  role: "content_manager" | "super_admin" | "staff_admin" | null
): Promise<Actor> {
  const user = await h.seed.member();
  if (role) await h.seed.grant(user, { role, scope: { type: "global" } });
  return h.signIn(user);
}

/**
 * Everything a competition needs before it can be published, written the
 * way the edit form gives it back (trimmed, canonical order, IST dates).
 */
export function completeFields(
  overrides: Partial<CompetitionFields> = {}
): CompetitionFields {
  return {
    code: "NEIGH27",
    name: "Neighbours on My Street",
    theme:
      "An animal that shares your street, and one kind thing you do for it.",
    welfareMessage: "Every street animal deserves water, shade and kindness.",
    rules: "One original artwork per participant. No AI-generated work.",
    permittedMaterials:
      "Pencil, crayon, watercolour or poster colour on A3 paper.",
    duration: "2 hours",
    participation: "both",
    disciplines: ["drawing", "painting"],
    ageGroups: [
      { label: "Group A", minAge: 5, maxAge: 8 },
      { label: "Group B", minAge: 9, maxAge: 12 },
    ],
    categories: [
      { discipline: "drawing", ageGroup: "Group A" },
      { discipline: "drawing", ageGroup: "Group B" },
      { discipline: "painting", ageGroup: "Group B" },
    ],
    ageCutoffDate: "2027-01-01",
    digitalScope: "shortlist_only",
    shortlistPerCategory: 6,
    schoolPositions: 3,
    physicalArtwork: { kind: "top_n", count: 4 },
    publicDisplay: true,
    auctionPermitted: false,
    keyDates: {
      registration_opens: "2027-01-15T10:00",
      registration_closes: "2027-02-15T23:59",
      submissions_close: "2027-02-28T23:59",
      school_round_closes: "2027-03-10T18:00",
    },
    ...overrides,
  };
}
