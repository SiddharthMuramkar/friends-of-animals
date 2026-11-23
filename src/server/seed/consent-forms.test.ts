import { describe, expect, it } from "vitest";

import { consentEvent, consentForm, fileAsset } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { seedConsentForms } from "./consent-forms";

describe("the synthetic signed-form seed", () => {
  it("keeps one accepted, pending and rejected form after a second seed", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const before = await h.db
      .select()
      .from(consentForm)
      .orderBy(consentForm.id);
    expect(before.map(({ status }) => status)).toEqual([
      "accepted",
      "pending_review",
      "rejected",
    ]);
    const files = await h.db.select().from(fileAsset);
    for (const form of before) {
      expect(files.find(({ id }) => id === form.fileAssetId)).toMatchObject({
        purpose: "consent_form",
        status: "clean",
      });
    }
    await seedConsentForms(h.deps);
    expect(
      await h.db.select().from(consentForm).orderBy(consentForm.id)
    ).toEqual(before);
    const events = await h.db.select().from(consentEvent);
    expect(
      events.filter(({ method }) => method === "paper_form")
    ).toMatchObject([
      {
        consentFormId: before[0]!.id,
        reviewerUserId: before[0]!.reviewedByUserId,
        purpose: "public_display",
      },
    ]);
  });
});
