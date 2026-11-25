import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createPgWorld } from "@/test/pg";
import { openToIndividuals, adultForm } from "../participants/testing";
import { publishFixture } from "../surveys/testing";
import { publishedRelease } from "../results/read-published";
import { latestDocument } from "../consent/repository";
import { insertConsentDocumentVersion } from "../consent/insert-version";
import { parseConsentDocumentBody } from "../consent/domain/document-body";
import { competitionInvitation } from "../../db/schema";
import { eq } from "drizzle-orm";

it("serializes the live publication and pilot backfill at the durable invitation boundary", async () => {
  const world = createPgWorld();
  try {
    await world.deps.settings.set("invitations.enabled", true);
    const code = `IV${randomUUID()
      .replace(/[^a-f]/g, "")
      .slice(0, 3)
      .toUpperCase()
      .padEnd(3, "A")}27`;
    const comp = await openToIndividuals(world, { code, fee: 0n });
    const superAdmin = await world.seed.superAdmin({
      email: world.uniqueEmail(),
    });
    await world.seed.authenticator(superAdmin);
    const owner = world.as(
      await world.signedIn(superAdmin, { secondFactor: true })
    );
    const member = await world.seed.member({ email: world.uniqueEmail() });
    const participant = world.as(await world.signedIn(member));
    let doc = await latestDocument(world.db, "messages");
    if (!doc) {
      const parsed = parseConsentDocumentBody({
        short: [["Draft optional updates"]],
        sections: [
          {
            id: "updates",
            title: "Updates",
            blocks: [{ p: ["Optional updates."] }],
          },
        ],
      });
      if (!parsed.ok) throw Error(parsed.issues.join("; "));
      await world.db.transaction((tx) =>
        insertConsentDocumentVersion(
          tx,
          { now: world.clock.now(), publishedByUserId: null },
          {
            purpose: "messages",
            title: null,
            body: parsed.body,
            legalRevisionId: null,
          }
        )
      );
      doc = await latestDocument(world.db, "messages");
    }
    expect(
      await participant.giveConsent({
        purpose: "messages",
        documentId: doc!.id,
      })
    ).toMatchObject({ ok: true });
    const reg = await participant.registerAsIndividual(adultForm(comp));
    if (!reg.ok) throw Error(reg.error);
    expect(
      await participant.payForMyRegistration({
        registrationId: reg.registrationId,
      })
    ).toMatchObject({ ok: true });
    await publishFixture(world, comp.id);
    const release = await publishedRelease(world.db, comp.id);
    const worker = world.as({ kind: "system", process: "worker" });
    const payload = {
      competitionId: comp.id,
      releaseId: release!.releaseId,
      publishedAt: release!.publishedAt.toISOString(),
    };
    const results = await Promise.all([
      owner.backfillPilotInvitations({ competitionId: comp.id }),
      worker.queuePublishedInvitations(payload),
      worker.queuePublishedInvitations(payload),
    ]);
    expect(
      results
        .filter((r) => r.ok)
        .map((r) => r.invited)
        .sort((a, b) => a - b)
    ).toEqual([0, 0, 1]);
    const [invite] = await world.db
      .select()
      .from(competitionInvitation)
      .where(eq(competitionInvitation.competitionId, comp.id));
    expect(invite?.recipientUserId).toEqual(member.id);
    await world.drain();
    const [visible] = await participant.myCompetitionInvitations();
    expect(visible?.id).toBe(invite!.id);
    const accepts = await Promise.all([
      participant.acceptCompetitionInvitation({
        invitationId: invite!.id,
        action: "volunteer",
      }),
      participant.acceptCompetitionInvitation({
        invitationId: invite!.id,
        action: "volunteer",
      }),
      participant.acceptCompetitionInvitation({
        invitationId: invite!.id,
        action: "attend_events",
      }),
    ]);
    expect(accepts.every((r) => r.ok)).toBe(true);
    expect(
      (await participant.myCompetitionInvitations())[0]?.acceptedActions.sort(
        (a, b) => a.localeCompare(b)
      )
    ).toEqual(["attend_events", "volunteer"]);
  } finally {
    await world.close();
  }
});
