import { can } from "../../access/can";
import { decide, type Resource } from "../../access/domain/policy";
import { grantsOf } from "../../access/grants";
import { POLICY, type Action } from "../../access/policies";
import { DomainError } from "../../errors";
import type { UseCaseContext } from "../../use-cases";

export type CompetitionScope = "all" | readonly string[];
export const competitionResource = (id: string): Resource => ({
  scopes: [{ type: "competition", id }],
});

/**
 * Scope for work the actor may read and perform. Use the actual action
 * rule for role eligibility, but the read action's factor requirement:
 * step-up is checked when approving, not on looking at the waiting count.
 */
export async function reportScope(
  ctx: UseCaseContext,
  read: Action,
  work: Action = read,
  scoped = true
): Promise<CompetitionScope> {
  if (ctx.actor.kind !== "user") return [];
  const grants = await grantsOf(ctx.db, ctx.actor.userId);
  const subject = { kind: "user", userId: ctx.actor.userId, grants } as const;
  const allowed = async (resource: Resource) => {
    if (!decide(POLICY, subject, work, resource).allowed) return false;
    const decision = await can(ctx, read, resource);
    if (!decision.allowed && "secondFactor" in decision)
      throw new DomainError(
        decision.secondFactor,
        "Second factor required to read this report"
      );
    return decision.allowed;
  };
  if (await allowed({})) return "all";
  if (!scoped) return [];
  const ids = [
    ...new Set(
      grants.flatMap((g) =>
        g.scope.type === "competition" ? [g.scope.id] : []
      )
    ),
  ];
  const visible: string[] = [];
  for (const id of ids)
    if (await allowed(competitionResource(id))) visible.push(id);
  return visible;
}
