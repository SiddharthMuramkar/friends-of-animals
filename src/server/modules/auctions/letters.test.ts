import { completedReturnWindow } from "./testing";
import { describe, it, expect } from "vitest";
import { createHarness } from "@/test/harness";
import { seedAuctionResults } from "@/test/seed-auction-results";
import { eq } from "drizzle-orm";
import {
  competition,
  competitionConsentDocument,
  registration,
} from "@/server/db/schema";
import { schoolInJudging, categoryOf } from "../school-round/testing";
import { publishNextVersion } from "../consent/testing";
import { guardianEmail } from "../payments/testing";
import { deliveredToken } from "../consent-links/testing";
import { seedConsentLinkTemplates } from "@/server/seed/consent-link-templates";
import { signedInVerifier } from "../verification/testing";
import { signedInWith, managerOf } from "../judging/testing";
import {
  conditionPhotos,
  verificationDetails,
} from "../physical-artwork/testing";
import { SEED_AUCTIONS } from "@/server/seed/auctions";
import { SEED_GUARDIANS } from "@/server/seed/guardians";

describe("auction thank-you letters", () => {
  it("thanks the child's verified guardian, never their linked teen account", async () => {
    const h = await createHarness();
    await seedAuctionResults(h.deps);
    const manager = h.as(await h.signIn(SEED_AUCTIONS.manager));
    const buyer = h.as(await h.signIn(await h.seed.member()));
    const worker = h.as({ kind: "system", process: "worker" });
    const visitor = h.as(h.visitor());
    const artwork = (await manager.listEligibleArtwork()).find(
      (a) => a.artworkCode === "AUCT27-A-5EED04"
    )!;
    const opensAt = new Date(h.clock.now().getTime() + 60_000),
      closesAt = new Date(opensAt.getTime() + 3600_000);
    const lot = await manager.createLot({
      artworkId: artwork.artworkId,
      story: "A child's creative work",
      basePricePaise: 10000n,
      reservePricePaise: 10000n,
      opensAt,
      closesAt,
    });
    if (!lot.ok) throw new Error("Lot refused");
    expect(await manager.scheduleLot({ lotId: lot.lotId })).toMatchObject({
      ok: true,
    });
    h.clock.set(opensAt);
    await worker.openLot({ lotId: lot.lotId });
    expect(
      await buyer.placeBid({
        lotCode: lot.lotCode,
        amountPaise: 10000n,
        declaredAdult: true,
        declarationVersion: "1",
      })
    ).toMatchObject({ ok: true });
    h.clock.set(closesAt);
    await worker.closeLot({ lotId: lot.lotId });
    await h.drain();
    const offer = (await buyer.getMyAuctionOffer({ lotCode: lot.lotCode }))!;
    const order = await buyer.openAuctionCheckout({ offerId: offer.id });
    if (!order.ok) throw new Error("Checkout refused");
    h.gateway.capture(order.checkout.orderId);
    expect(
      await visitor.receiveGatewayWebhook(
        h.gateway.webhook({
          type: "payment.captured",
          orderId: order.checkout.orderId,
        })
      )
    ).toMatchObject({ ok: true, outcome: "captured" });
    await h.drain();
    const title = `Thank you for contributing artwork ${lot.lotCode}`;
    expect(
      h.email.sent.filter((m) => m.subject === title).map((m) => m.to)
    ).toEqual([SEED_GUARDIANS.guardian.email]);
    const teen = h.as(await h.signIn(SEED_GUARDIANS.teen));
    expect((await teen.listInbox()).some((m) => m.title === title)).toBe(false);
  });
  it("thanks the school and the current verified family contact without exposing the buyer", async () => {
    const h = await createHarness();
    await h.settings.set("auctions.enabled", true);
    await seedConsentLinkTemplates(h.deps);
    const world = await schoolInJudging(h, {
      students: 1,
      submit: [1],
      beforeJudging: async (school) => {
        const id = school.competition.id;
        await h.db
          .update(competition)
          .set({ auctionPermitted: true, physicalArtwork: "all_shortlisted" })
          .where(eq(competition.id, id));
        const doc = await publishNextVersion(h, "auction");
        await h.db.insert(competitionConsentDocument).values({
          competitionId: id,
          purpose: "auction",
          consentDocumentId: doc.id,
          attachedAt: h.clock.now(),
        });
        const [row] = await h.db
          .select({ profileId: registration.participantProfileId })
          .from(registration)
          .where(eq(registration.id, school.registrationIds[0]!));
        const coordinator = h.as(school.coordinator.actor);
        const sent = await coordinator.sendConsentLink({
          institutionId: school.institutionId,
          registrationId: school.registrationId,
          studentId: row!.profileId,
          channel: "email",
          address: guardianEmail(1),
        });
        if (!sent.ok) throw new Error(`Consent link refused: ${sent.error}`);
        await h.drain();
        const token = deliveredToken(h, guardianEmail(1));
        const guest = h.as(h.visitor());
        await guest.sendConsentLinkCode({ token });
        const code = h.email.codeFor(guardianEmail(1))!;
        const verified = await guest.verifyConsentLinkCode({ token, code });
        if (!verified.ok) throw new Error("Consent OTP refused");
        expect(
          await guest.answerConsentLink({
            token,
            sessionToken: verified.sessionToken,
            answers: { auction: "give" },
          })
        ).toMatchObject({ ok: true });
      },
    });
    const coordinator = h.as(world.coordinator.actor);
    await coordinator.recordPanel({
      ...world.ref,
      members: [{ fullName: "Sample art teacher", designation: "Teacher" }],
    });
    expect(await coordinator.certifyConduct(world.ref)).toMatchObject({
      ok: true,
    });
    const entryId = world.entryIds[1]!;
    expect(
      await coordinator.saveShortlist({
        ...world.ref,
        categoryId: await categoryOf(h, world, "photography"),
        picks: [{ entryId, position: 1 }],
      })
    ).toMatchObject({ ok: true });
    expect(
      await coordinator.finaliseSchoolRound({
        ...world.ref,
        judgingAttested: true,
      })
    ).toMatchObject({ ok: true });
    await h.drain();
    const verifier = await signedInVerifier(h);
    const competitionId = world.competition.id;
    const compManager = h.as(await signedInWith(h, managerOf(competitionId)));
    expect(await h.as(verifier).verifyEntry({ entryId })).toMatchObject({
      ok: true,
    });
    const requested = await compManager.requestPhysicalArtwork({
      competitionId,
      entryIds: [entryId],
    });
    if (!requested.ok) throw new Error("Artwork not requested");
    const artworkId = requested.artworks[0]!.artworkId;
    expect(
      await h.as(verifier).markArtworkReceived({ artworkId })
    ).toMatchObject({ ok: true });
    const photos = await conditionPhotos(h, verifier, artworkId);
    expect(
      await h
        .as(verifier)
        .verifyArtwork({ artworkId, ...verificationDetails, photos })
    ).toMatchObject({ ok: true });
    const manager = h.as(
      await signedInWith(h, {
        role: "auction_manager",
        scope: { type: "global" },
      })
    );
    const buyerAccount = await h.seed.member();
    const buyer = h.as(await h.signIn(buyerAccount));
    const worker = h.as({ kind: "system", process: "worker" });
    const visitor = h.as(h.visitor());
    const opensAt = new Date(h.clock.now().getTime() + 60_000),
      closesAt = new Date(opensAt.getTime() + 3600_000);
    await completedReturnWindow(h, competitionId);
    const lot = await manager.createLot({
      artworkId,
      story: "School artwork",
      basePricePaise: 10000n,
      reservePricePaise: 10000n,
      opensAt,
      closesAt,
    });
    if (!lot.ok) throw new Error(`Lot refused: ${lot.error}`);
    await manager.scheduleLot({ lotId: lot.lotId });
    h.clock.set(opensAt);
    await worker.openLot({ lotId: lot.lotId });
    expect(
      await buyer.placeBid({
        lotCode: lot.lotCode,
        amountPaise: 10000n,
        declaredAdult: true,
        declarationVersion: "1",
      })
    ).toMatchObject({ ok: true });
    h.clock.set(closesAt);
    await worker.closeLot({ lotId: lot.lotId });
    await h.drain();
    const offer = (await buyer.getMyAuctionOffer({ lotCode: lot.lotCode }))!;
    const order = await buyer.openAuctionCheckout({ offerId: offer.id });
    if (!order.ok) throw new Error("Checkout refused");
    h.gateway.capture(order.checkout.orderId);
    await visitor.receiveGatewayWebhook(
      h.gateway.webhook({
        type: "payment.captured",
        orderId: order.checkout.orderId,
      })
    );
    await h.drain();
    const title = `Thank you for contributing artwork ${lot.lotCode}`;
    expect(
      h.email.sent.filter((m) => m.subject === title).map((m) => m.to)
    ).toEqual([guardianEmail(1)]);
    expect(
      (await coordinator.listInbox()).some(
        (m) => m.title === `Thank you to your school for artwork ${lot.lotCode}`
      )
    ).toBe(true);
    expect(
      h.email.sent
        .filter(
          (m) =>
            m.subject.includes(lot.lotCode) && m.subject.startsWith("Thank you")
        )
        .every((m) => !m.text.includes(buyerAccount.name))
    ).toBe(true);
  });
});
