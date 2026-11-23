import { describe, expect, it } from "vitest";

import { createHarness } from "@/test/harness";

import { changeConsent } from "./change-consent";

describe("the guardian consent actions", () => {
  it.each(["give", "withdraw"] as const)(
    "handles a %s submission with absent consent details",
    async (kind) => {
      const h = await createHarness();
      const guardian = await h.seed.guardian({
        children: [{ fullName: "Asha Kulkarni", age: 9 }],
      });
      await h.signIn(guardian.account);

      await expect(
        changeConsent(h, { kind, input: undefined })
      ).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    }
  );
});
