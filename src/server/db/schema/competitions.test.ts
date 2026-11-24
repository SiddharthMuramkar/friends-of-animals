import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createHarness } from "@/test/harness";

import { competition } from "./competitions";

describe("competition cancellation metadata", () => {
  it("requires a cancellation time and reason when a published competition is cancelled", async () => {
    const h = await createHarness();
    const { id } = await h.seed.competition({ status: "published" });

    await expect(
      h.db
        .update(competition)
        .set({ status: "cancelled" })
        .where(eq(competition.id, id))
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint: "competition_cancellation_complete" },
    });
  });

  it.each(["draft", "published"] as const)(
    "refuses cancellation metadata on a %s competition",
    async (status) => {
      const h = await createHarness();
      const { id } = await h.seed.competition({ status });

      await expect(
        h.db
          .update(competition)
          .set({
            status: "registration_open",
            cancelledAt: h.clock.now(),
            cancelReason: "The venue closed.",
          })
          .where(eq(competition.id, id))
      ).rejects.toMatchObject({
        cause: {
          code: "23514",
          constraint: "competition_cancellation_complete",
        },
      });
    }
  );
});
