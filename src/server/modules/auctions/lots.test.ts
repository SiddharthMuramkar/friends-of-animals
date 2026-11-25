import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { conditionPhotos, verificationDetails } from "../physical-artwork/testing";
import { submittedIndividualEntry, closeSubmissions } from "../verification/testing";
import { signedInVerifier } from "../verification/testing";
import { consentCompetition } from "../consent/testing";
import { signedInWith, managerOf } from "../judging/testing";

describe("auction lots", () => {
  it("reserves verified, consented artwork only once, and refuses a competition manager", async () => {
    const h = await createHarness();
    const competition = await consentCompetition(h,{fee:0n, physicalArtwork: { kind: "all_shortlisted" }});
    const artist = await submittedIndividualEntry(h, {competition});
    await closeSubmissions(h);
    const competitionId = artist.competition.id;
    const manager = await signedInWith(h, managerOf(competitionId));
    const verifier = await signedInVerifier(h);
    const auctioneer = await signedInWith(h, { role: "auction_manager", scope: { type: "global" } });
    expect(await h.as(verifier).verifyEntry({ entryId: artist.entryId })).toMatchObject({ ok: true });
    const requested = await h.as(manager).requestPhysicalArtwork({ competitionId, entryIds: [artist.entryId] });
    if (!requested.ok) throw new Error("Request failed");
    const { artworkId } = requested.artworks[0]!;
    expect(await h.as(verifier).markArtworkReceived({ artworkId })).toMatchObject({ ok: true });
    const input = { artworkId, story: "A celebration of kindness", basePricePaise: 10000n, reservePricePaise: 15000n,
      opensAt: new Date(h.clock.now().getTime()+3600000), closesAt: new Date(h.clock.now().getTime()+7200000) };
    await expect(h.as(manager).createLot(input)).rejects.toMatchObject({ code: "forbidden" });
    expect(await h.as(auctioneer).createLot(input)).toMatchObject({ok:false, error:"ineligible", reasons:["artwork_not_listable"]});
    const photos = await conditionPhotos(h, verifier, artworkId);
    expect(await h.as(verifier).verifyArtwork({ artworkId, ...verificationDetails, photos })).toMatchObject({ok:true});
    const created = await h.as(auctioneer).createLot(input);
    expect(created).toMatchObject({ok:true, lotCode: /^LOT-\d{2}-[0-9A-HJKMNP-TV-Z]{5}$/});
    expect(await h.as(auctioneer).createLot(input)).toMatchObject({ok:false, error:"ineligible", reasons:["already_listed"]});
  });
});
