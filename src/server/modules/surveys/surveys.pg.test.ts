import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createPgWorld } from "@/test/pg";
import { openToIndividuals, adultForm } from "../participants/testing";
import { publishFixture } from "./testing";
import { managerOf } from "../judging/testing";
import { latestDocument } from "../consent/repository";
import { insertConsentDocumentVersion } from "../consent/insert-version";
import { parseConsentDocumentBody } from "../consent/domain/document-body";
import { surveyInvitation } from "../../db/schema";
import { eq } from "drizzle-orm";
import { surveyToken } from "./token";

it("locks sending and the one-response boundary under concurrent dashboard and bearer submissions", async () => {
  const world = createPgWorld();
  try {
    await world.deps.settings.set("surveys.enabled", true);
    const suffix = randomUUID()
      .replace(/[^a-f]/g, "")
      .slice(0, 3)
      .toUpperCase()
      .padEnd(3, "A");
    const comp = await openToIndividuals(world, {
      code: `SV${suffix}27`,
      fee: 0n,
    });
    const manager = await world.seed.member({ email: world.uniqueEmail() });
    await world.seed.grant(manager, managerOf(comp.id));
    await world.seed.authenticator(manager);
    const staff = world.as(
      await world.signedIn(manager, { secondFactor: true })
    );
    const person = await world.seed.member({ email: world.uniqueEmail() });
    const participant = world.as(await world.signedIn(person));
    let doc = await latestDocument(world.db, "messages");
    if (!doc) {
      const parsed = parseConsentDocumentBody({
        short: [["Draft messages consent"]],
        sections: [
          { id: "consent", title: "Consent", blocks: [{ p: ["Messages."] }] },
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
    expect(
      await staff.saveSurvey({
        competitionId: comp.id,
        title: "Racing responses",
        questions: [{ text: "Feedback?", choices: ["Yes", "No"] }],
      })
    ).toMatchObject({ ok: true });
    const sent = await Promise.all([
      staff.sendSurvey({ competitionId: comp.id }),
      staff.sendSurvey({ competitionId: comp.id }),
    ]);
    expect(sent.filter((r) => r.ok)).toEqual([{ ok: true, invited: 1 }]);
    expect(sent.filter((r) => !r.ok)).toEqual([
      { ok: false, error: "unavailable" },
    ]);
    const [invitation] = await world.db
      .select({ id: surveyInvitation.id })
      .from(surveyInvitation)
      .where(eq(surveyInvitation.userId, person.id));
    const token = surveyToken(world.deps.blindIndex, invitation!.id).token;
    const visitor = world.as({
      kind: "visitor",
      meta: { ip: "198.18.0.1", userAgent: "PG test" },
    });
    const answered = await Promise.all([
      participant.answerSurvey({ competitionId: comp.id, answers: [0] }),
      visitor.answerSurvey({ token, answers: [1] }),
    ]);
    expect(answered.filter((r) => r.ok)).toEqual([{ ok: true }]);
    expect(answered.filter((r) => !r.ok)).toEqual([
      { ok: false, error: "unavailable" },
    ]);
    expect(await staff.getSurvey({ competitionId: comp.id })).toMatchObject({
      results: { invited: 1, responses: 1 },
    });
  } finally {
    await world.close();
  }
});
