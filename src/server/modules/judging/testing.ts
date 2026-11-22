// Test helpers for the judging module: competitions to write rubrics for,
// and competition managers to write them. Tests only: nothing in the app
// imports this file.

import type { Grant } from "../../access/domain/roles";
import type { Actor } from "../../actor";
import { competition } from "../../db/schema";
import { uuidv7 } from "../../ids";
import type { Harness } from "../../../test/harness";
import type {
  CompetitionStatus,
  Discipline,
} from "../competitions/domain/vocabulary";

let competitions = 0;

/**
 * Inserts a competition with only the fields judging reads. Published by
 * default, so nothing about its status gets in the way.
 */
export async function seedCompetition(
  h: Harness,
  options: {
    disciplines?: Discipline[];
    status?: CompetitionStatus;
    participation?: "individuals" | "institutions" | "both";
    name?: string;
  } = {}
): Promise<{ id: string; code: string; name: string }> {
  competitions += 1;
  const now = h.clock.now();
  const status = options.status ?? "published";
  const row = {
    id: uuidv7(now),
    code: `RUB${String(competitions % 100).padStart(2, "0")}`,
    slug: `rubric-test-${competitions}`,
    name: options.name ?? `Rubric test ${competitions}`,
    participation: options.participation ?? "both",
    disciplines: options.disciplines ?? ["drawing", "essay"],
    status,
    publishedAt: status === "draft" ? null : now,
    createdAt: now,
    updatedAt: now,
  };
  await h.db.insert(competition).values(row);
  return { id: row.id, code: row.code, name: row.name };
}

/** A signed-in user holding `grants` (none: a plain member). */
export async function signedInWith(
  h: Harness,
  ...grants: Grant[]
): Promise<Actor> {
  const user = await h.seed.member();
  await h.seed.grant(user, ...grants);
  return h.signIn(user);
}

/** A competition manager for every competition. */
export const globalManager: Grant = {
  role: "competition_manager",
  scope: { type: "global" },
};

/** A competition manager for one competition. */
export function managerOf(competitionId: string): Grant {
  return {
    role: "competition_manager",
    scope: { type: "competition", id: competitionId },
  };
}
