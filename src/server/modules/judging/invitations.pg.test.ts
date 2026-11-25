import { randomInt } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createPgWorld, type PgWorld } from "@/test/pg";
import { judgeInvitation, userRole } from "../../db/schema";
import { createLinkToken } from "../../crypto/link-token";
let world: PgWorld;
beforeAll(() => {
  world = createPgWorld();
});
afterAll(async () => {
  await world.close();
});
it("accepts a round invitation at most once on two concurrent requests", async () => {
  const letters = Array.from({ length: 6 }, () =>
    String.fromCharCode(65 + randomInt(26))
  ).join("");
  const competition = await world.seed.competition({
    code: `${letters}27`,
    name: `Judge race ${letters}`,
    disciplines: ["drawing"],
  });
  const manager = await world.seed.member({ email: world.uniqueEmail() });
  await world.seed.grant(manager, {
    role: "competition_manager",
    scope: { type: "competition", id: competition.id },
  });
  await world.seed.authenticator(manager);
  const api = world.as(await world.signedIn(manager, { secondFactor: true }));
  const rubric = await api.createRubricDraft({
    competitionId: competition.id,
    discipline: "drawing",
  });
  if (!rubric.ok) throw new Error(rubric.error);
  await api.publishRubric({ rubricId: rubric.rubric.id });
  const round = await api.createJudgingRound({
    competitionId: competition.id,
    name: "National",
  });
  if (!round.ok) throw new Error(round.error);
  const invitee = await world.seed.member({ email: world.uniqueEmail() });
  const invited = await api.inviteJudge({
    roundId: round.roundId,
    email: invitee.email,
  });
  if (!invited.ok) throw new Error(invited.error);
  // Substitute a known token hash, equivalent to reading the sent message.
  const { token, tokenHash } = createLinkToken();
  await world.db
    .update(judgeInvitation)
    .set({ tokenHash })
    .where(eq(judgeInvitation.id, invited.invitationId));
  const judge = world.as(await world.signedIn(invitee));
  const [a, b] = await Promise.all([
    judge.acceptJudgeInvitation({ token }),
    judge.acceptJudgeInvitation({ token }),
  ]);
  expect([a, b]).toContainEqual({ ok: true, roundId: round.roundId });
  expect([a, b]).toContainEqual({ ok: false, error: "already_accepted" });
  expect(
    await world.db
      .select()
      .from(userRole)
      .where(
        and(
          eq(userRole.userId, invitee.id),
          eq(userRole.role, "judge"),
          eq(userRole.scopeId, round.roundId)
        )
      )
  ).toHaveLength(1);
});
