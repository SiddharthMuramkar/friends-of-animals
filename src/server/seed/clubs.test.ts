import { expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { SEED_CLUB } from "./club-fixtures";
import { SEED_INSTITUTIONS } from "./institutions";
import { SEED_VOLUNTEERS } from "./volunteers";
it("seeds one approved club and the teacher's timeline without duplicating membership", async () => {
  const h = await createHarness();
  await h.seed.preview();
  await h.seed.preview();
  expect(await h.settings.get("clubs.enabled")).toBe(true);
  const teacher = h.as(await h.signIn(SEED_INSTITUTIONS.verified.admin));
  expect(await teacher.listMyClubs()).toMatchObject({
    clubs: [
      { id: SEED_CLUB.id, status: "approved", memberCount: 1, joined: true },
    ],
  });
  expect(
    (await teacher.getTimeline()).entries.filter(
      (e) => e.kind === "club.joined"
    )
  ).toHaveLength(1);
  const manager = h.as(await h.signIn(SEED_VOLUNTEERS.manager));
  expect(await manager.listClubsForReview()).toMatchObject({
    clubs: [{ id: SEED_CLUB.id, status: "approved" }],
  });
});
