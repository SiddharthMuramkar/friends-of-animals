import { expect, it } from "vitest";
import { createHarness, type Harness } from "@/test/harness";
import { seedAuctionResults } from "@/test/seed-auction-results";
import { seedGallery } from "../../seed/gallery";
import { seedSocialExport } from "../../seed/social-export";
import { signedInWith } from "../judging/testing";
import { SEED_ACCOUNTS } from "../../seed/accounts";
import { SEED_AUCTION_COMPETITION } from "../../seed/competitions";
import { SEED_SOCIAL_EXPORT } from "../../seed/social-export-samples";
import { SEED_GALLERY } from "../../seed/gallery-samples";

async function seed(h: Harness) {
  await seedAuctionResults(h.deps);
  await seedGallery(h.deps);
  await seedSocialExport(h.deps);
}

it("seeds distinct demo grants and actual social stamps, and lets the adult creator withdraw their own permission without resurrecting the export on reseed", async () => {
  const h = await createHarness();
  await seed(h);
  const curator = h.as(
    await signedInWith(h, {
      role: "content_manager",
      scope: { type: "global" },
    })
  );
  const owner = h.as(
    await h.signIn(
      await h.seed.member({ email: SEED_ACCOUNTS.members[0].email })
    )
  );
  const visitor = h.as(h.visitor());
  const id = { exportId: SEED_SOCIAL_EXPORT.queued };
  const own = {
    competitionId: SEED_AUCTION_COMPETITION.id,
    purpose: "social_media" as const,
  };
  expect(await curator.listSocialExports()).toMatchObject([
    {
      ...id,
      itemId: SEED_GALLERY.items[0],
      status: "pending",
      stampReady: true,
    },
  ]);
  expect(await curator.listSocialExportCandidates()).toEqual([
    {
      itemId: SEED_GALLERY.items[2],
      title: "Our friends",
      credit: { name: "Isha D.", school: "Green Valley School", city: "Pune" },
      sampleIllustration: true,
    },
  ]);
  await expect(visitor.myPublicUseConsents()).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(visitor.withdrawMyPublicUseConsent(own)).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(await curator.withdrawMyPublicUseConsent(own)).toMatchObject({
    ok: true,
    changed: false,
  });
  expect(await owner.myPublicUseConsents()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ ...own, state: "given" }),
    ])
  );
  expect(await owner.withdrawMyPublicUseConsent(own)).toMatchObject({
    ok: true,
    changed: true,
  });
  expect(await owner.myPublicUseConsents()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ ...own, state: "withdrawn" }),
    ])
  );
  expect(await curator.listSocialExports()).toEqual([]);
  expect(await curator.getSocialExportDownload(id)).toMatchObject({
    ok: false,
  });
  await h.drain();
  expect(await curator.getSocialExportDownload(id)).toEqual({
    ok: false,
    error: "not_found",
  });
  await seed(h);
  expect(await curator.listSocialExports()).toEqual([]);
  expect(await owner.myPublicUseConsents()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ ...own, state: "withdrawn" }),
    ])
  );
});
