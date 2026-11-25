import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { competitionInvitation } from "../db/schema";
import { SEED_AUCTIONS } from "./auctions";
import { SEED_RESULTS } from "./results";

it("seeds the synthetic published cohort once and preserves accepted choices on reseed", async () => {
  const h = await createHarness();
  await h.seed.preview();
  const api = h.as(await h.signIn(SEED_AUCTIONS.artist));
  await h.drain();
  expect(await h.settings.get("invitations.enabled")).toBe(true);
  const [invite] = await api.myCompetitionInvitations();
  expect(invite).toMatchObject({
    competitionId: SEED_RESULTS.competitionId,
    acceptedActions: [],
  });
  expect(
    await api.acceptCompetitionInvitation({
      invitationId: invite!.id,
      action: "attend_events",
    })
  ).toMatchObject({ ok: true });
  await h.seed.preview();
  await h.drain();
  expect(await api.myCompetitionInvitations()).toMatchObject([
    { id: invite!.id, acceptedActions: ["attend_events"] },
  ]);
  expect(
    await h.db
      .select()
      .from(competitionInvitation)
      .where(eq(competitionInvitation.recipientUserId, SEED_AUCTIONS.artist.id))
  ).toHaveLength(1);
});
