import { expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { seedFunctions } from "./builders";
import { SEED_CLUB } from "./club-fixtures";
import { seedClubs } from "./clubs";
import { SEED_INSTITUTIONS } from "./institutions";
import { seedSettings } from "./settings";
import { SEED_VOLUNTEERS } from "./volunteers";
it("seeds one approved club and the teacher's timeline without duplicating membership", async () => {
  const h = await createHarness();
  await h.seed.preview();
  const teacher = h.as(await h.signIn(SEED_INSTITUTIONS.verified.admin));
  const manager = h.as(await h.signIn(SEED_VOLUNTEERS.manager));
  async function expectSeededClub() {
    expect(await h.settings.get("clubs.enabled")).toBe(true);
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
    expect(await manager.listClubsForReview()).toMatchObject({
      clubs: [{ id: SEED_CLUB.id, status: "approved" }],
    });
  }
  // Verify the integrated preview first, including the school and manager;
  // its club and settings seeders can then rerun over those existing rows.
  await expectSeededClub();
  await seedFunctions([seedSettings, seedClubs]).seedPreview(h.deps);
  await expectSeededClub();
});
