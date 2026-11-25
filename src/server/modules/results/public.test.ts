import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import {
  competitionConsentDocument,
  participantProfile,
} from "../../db/schema";
import { SEED_RESULTS } from "../../seed/results";
import { SEED_GUARDIANS } from "../../seed/guardians";

describe("the public results read", () => {
  it("reads current consent and each guardian credit opt-in, never identifier or unconsented award", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const { slug, competitionId } = SEED_RESULTS;
    const api = h.as(h.visitor());
    const before = await api.getPublicResults({ slug });
    expect(before?.awards).toHaveLength(2);
    expect(before?.awards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ credit: { name: "Asha Rao" } }),
        expect.objectContaining({ credit: { name: "Rohan D." } }),
      ])
    );
    // Use the actual teen's current stored name and details, checking the
    // specific safe credit projection independently of the full record.
    const childId = SEED_GUARDIANS.children.teen.profileId;
    const [profile] = await h.db
      .select()
      .from(participantProfile)
      .where(eq(participantProfile.id, childId));
    if (!profile) throw Error("Missing seed participant");
    const serialized = JSON.stringify(before);
    expect(serialized).not.toContain(childId);
    expect(serialized).not.toContain(profile.fullName);
    expect(serialized).not.toContain("AUCT27-E-");
    const docs = await h.db
      .select()
      .from(competitionConsentDocument)
      .where(eq(competitionConsentDocument.competitionId, competitionId));
    const documentId = docs.find(
      (d) => d.purpose === "public_display"
    )!.consentDocumentId;
    const actor = await h.signIn(SEED_GUARDIANS.guardian);
    const guardian = h.as(actor);
    const target = { childId, competitionId };
    // The seed's minor doesn't necessarily have school/city strings; these
    // fixture facts make independent opt-ins observable at the public seam.
    await h.db
      .update(participantProfile)
      .set({ schoolName: "Sample learning centre", city: "Pune" })
      .where(eq(participantProfile.id, childId));
    expect(JSON.stringify(await api.getPublicResults({ slug }))).not.toContain(
      "Sample learning centre"
    );
    expect(JSON.stringify(await api.getPublicResults({ slug }))).not.toContain(
      "Pune"
    );
    expect(
      await guardian.giveChildConsent({
        ...target,
        purpose: "display_school",
        documentId,
      })
    ).toMatchObject({ ok: true });
    expect(JSON.stringify(await api.getPublicResults({ slug }))).toContain(
      "Sample learning centre"
    );
    expect(JSON.stringify(await api.getPublicResults({ slug }))).not.toContain(
      "Pune"
    );
    expect(
      await guardian.giveChildConsent({
        ...target,
        purpose: "display_city",
        documentId,
      })
    ).toMatchObject({ ok: true });
    expect(JSON.stringify(await api.getPublicResults({ slug }))).toContain(
      "Pune"
    );
    expect(
      await guardian.withdrawChildConsent({
        ...target,
        purpose: "display_school",
      })
    ).toMatchObject({ ok: true });
    expect(JSON.stringify(await api.getPublicResults({ slug }))).not.toContain(
      "Sample learning centre"
    );
    expect(JSON.stringify(await api.getPublicResults({ slug }))).toContain(
      "Pune"
    );
    expect(
      await guardian.withdrawChildConsent({
        ...target,
        purpose: "display_city",
      })
    ).toMatchObject({ ok: true });
    expect(JSON.stringify(await api.getPublicResults({ slug }))).not.toContain(
      "Pune"
    );
    expect(
      await guardian.withdrawChildConsent({
        ...target,
        purpose: "public_display",
      })
    ).toMatchObject({ ok: true });
    expect(await api.getPublicResults({ slug })).toMatchObject({
      awards: [expect.objectContaining({ credit: { name: "Asha Rao" } })],
    });
    await expect(
      h.as({ kind: "system", process: "worker" }).getPublicResults({ slug })
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
