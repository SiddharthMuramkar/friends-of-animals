import { describe, expect, it } from "vitest";
import { createHarness, type Harness } from "@/test/harness";
import {
  consentCompetition,
  guardianWithChild,
  publishNextVersion,
} from "../consent/testing";
import { person, publishDocument } from "../campaigns/testing";
import { managerOf, signedInWith } from "../judging/testing";
import { competition, guardianLink } from "../../db/schema";
import { eq } from "drizzle-orm";
import { childForm } from "../consent/testing";
import { signedInOfficer } from "../privacy/requests/testing";
import { adultForm } from "../participants/testing";
import { seedInstitution } from "@/test/institutions";
import { signInCoordinator } from "../registration/testing";
import { latestDocument } from "../consent/repository";
import { surveyFeedbackMetrics } from "./results";
import { collectSubjectData } from "../privacy/requests/subject-data/collect";

import { publishFixture } from "./testing";
const questions = [
  { text: "How was the competition?", choices: ["1", "2", "3", "4", "5"] },
  { text: "Would you take part again?", choices: ["Yes", "No"] },
];
describe("competition surveys", () => {
  it("sends only after real publication and accepts one answer across link and dashboard; manager sees aggregate only", async () => {
    const h = await createHarness();
    await h.settings.set("surveys.enabled", true);
    const comp = await consentCompetition(h, { fee: 0n });
    const manager = h.as(await signedInWith(h, managerOf(comp.id)));
    const adult = await person(h, {
      name: "Adult",
      email: "adult-feedback@example.test",
      registerFor: { competition: comp },
    });
    const registrations = await h.as(adult.actor).listMyRegistrations();
    expect(
      await h.as(adult.actor).payForMyRegistration({
        registrationId: registrations[0]!.registrationId,
      })
    ).toMatchObject({ ok: true });
    const other = await person(h, {
      name: "Other",
      email: "other-feedback@example.test",
    });
    const denied = h.as(other.actor);
    await expect(
      denied.saveSurvey({
        competitionId: comp.id,
        title: "Feedback",
        questions,
      })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await manager.listSurveyCompetitions()).toMatchObject([
      { id: comp.id },
    ]);
    await expect(denied.listSurveyCompetitions()).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      h
        .as(
          await signedInWith(
            h,
            managerOf("01938a00-0000-7000-8000-000000009999")
          )
        )
        .getSurvey({ competitionId: comp.id })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await manager.saveSurvey({
        competitionId: comp.id,
        title: "Invalid",
        questions: [{ text: "One choice", choices: ["yes"] }],
      })
    ).toMatchObject({ ok: false, error: "invalid_input" });
    expect(
      await manager.saveSurvey({
        competitionId: comp.id,
        title: "Feedback",
        questions,
      })
    ).toMatchObject({ ok: true });
    expect(await manager.sendSurvey({ competitionId: comp.id })).toMatchObject({
      ok: false,
      error: "results_not_published",
    });
    await h.db
      .update(competition)
      .set({ status: "results_published" })
      .where(eq(competition.id, comp.id));
    expect(await manager.sendSurvey({ competitionId: comp.id })).toMatchObject({
      ok: false,
      error: "results_not_published",
    });
    await publishFixture(h, comp.id);
    await expect(
      denied.sendSurvey({ competitionId: comp.id })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await manager.sendSurvey({ competitionId: comp.id })).toMatchObject({
      ok: true,
      invited: 1,
    });
    await h.drain();
    const token = h.email.sent
      .find((m) => m.to === adult.email && m.text.includes("/feedback/"))
      ?.text.match(/\/feedback\/([a-f0-9]{64})/)?.[1];
    expect(token).toBeTruthy();
    const dashboard = h.as(adult.actor);
    const visitor = h.as(h.visitor());
    expect(await dashboard.mySurveys()).toMatchObject([
      { competitionId: comp.id, title: "Feedback" },
    ]);
    expect(await denied.mySurveys()).toEqual([]);
    expect(await visitor.getSurveyAnswerForm({ token: token! })).toMatchObject({
      title: "Feedback",
      questions,
    });
    await expect(visitor.mySurveys()).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      visitor.getSurveyAnswerForm({ competitionId: comp.id })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      visitor.answerSurvey({ competitionId: comp.id, answers: [3, 0] })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await denied.getSurveyAnswerForm({ competitionId: comp.id })
    ).toBeNull();
    expect(
      await denied.answerSurvey({ competitionId: comp.id, answers: [3, 0] })
    ).toMatchObject({ ok: false, error: "unavailable" });
    await expect(
      h
        .as({ kind: "system", process: "worker" })
        .getSurveyAnswerForm({ token: token! })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      h
        .as({ kind: "system", process: "worker" })
        .answerSurvey({ token: token!, answers: [3, 0] })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await visitor.answerSurvey({ token: token!, answers: [3, 0, 1] })
    ).toMatchObject({ ok: false, error: "invalid_input" });
    expect(
      await visitor.answerSurvey({ token: token!, answers: [3, 0] })
    ).toMatchObject({ ok: true });
    expect(
      await dashboard.answerSurvey({ competitionId: comp.id, answers: [4, 1] })
    ).toMatchObject({ ok: false, error: "unavailable" });
    await expect(
      denied.getSurvey({ competitionId: comp.id })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await manager.getSurvey({ competitionId: comp.id })).toMatchObject({
      results: {
        invited: 1,
        responses: 1,
        counts: [
          [0, 0, 0, 1, 0],
          [1, 0],
        ],
      },
    });
    await expect(
      denied.exportSurvey({ competitionId: comp.id })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await manager.exportSurvey({ competitionId: comp.id })
    ).toMatchObject({
      ok: true,
      csv: expect.not.stringContaining(adult.email),
    });
    const own = await collectSubjectData(h.deps, {
      scope: { userIds: [adult.userId], profileIds: [] },
      subject: { kind: "user", id: adult.userId },
      reference: "FIXTURE",
      generatedAt: h.clock.now(),
    });
    expect(own.document.sections.survey_invitation).toEqual([
      expect.objectContaining({ answers: [3, 0] }),
    ]);
    expect(
      JSON.stringify(own.document.sections.survey_invitation)
    ).not.toContain(token!);
    expect(
      JSON.stringify(own.document.sections.survey_invitation)
    ).not.toContain("token_hash");
    expect(
      await surveyFeedbackMetrics(h.db, {
        from: new Date(h.clock.now().getTime() - 1),
        to: new Date(h.clock.now().getTime() + 1),
      })
    ).toEqual({ surveysSent: 1, invited: 1, responses: 1 });
    await expect(
      denied.closeSurvey({ competitionId: comp.id })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await manager.closeSurvey({ competitionId: comp.id })).toEqual({
      ok: true,
    });
    expect(
      await manager.saveSurvey({
        competitionId: comp.id,
        title: "Changed",
        questions,
      })
    ).toMatchObject({ ok: false, error: "unavailable" });
    expect(await manager.sendSurvey({ competitionId: comp.id })).toMatchObject({
      ok: false,
      error: "unavailable",
    });
    await h.settings.set("retention.enforce", true);
    await h.settings.set("retention.surveyResponsesDays", 1);
    h.clock.advance({ days: 2 });
    expect(
      (await h.as({ kind: "system", process: "worker" }).runRetentionSweep())
        .policies.surveyResponses
    ).toMatchObject({ deleted: 1 });
    expect(await manager.getSurvey({ competitionId: comp.id })).toMatchObject({
      results: { invited: 0, responses: 0 },
    });
  });
});

async function confirmAdult(
  h: Harness,
  actor: Parameters<Harness["as"]>[0],
  competitionSlug: string
) {
  const reg = (await h.as(actor).listMyRegistrations()).find(
    (r) => r.competition.slug === competitionSlug
  );
  if (!reg) throw new Error("Missing registration");
  expect(
    await h
      .as(actor)
      .payForMyRegistration({ registrationId: reg.registrationId })
  ).toMatchObject({ ok: true });
}
function emailedToken(h: Harness, email: string) {
  return h.email.sent
    .find((m) => m.to === email && m.text.includes("/feedback/"))
    ?.text.match(/\/feedback\/([a-f0-9]{64})/)?.[1];
}
it("coalesces eligible adult links, never invites a teen directly, and rechecks consent at dispatch and answer", async () => {
  const h = await createHarness();
  await h.settings.set("surveys.enabled", true);
  const comp = await consentCompetition(h, { fee: 0n, participation: "both" });
  const manager = h.as(await signedInWith(h, managerOf(comp.id)));
  const teen = await person(h, {
    name: "Teen",
    email: "survey-teen@example.test",
  });
  const child = await guardianWithChild(h, comp, {
    age: 15,
    loginUserId: teen.userId,
  });
  const parent = h.as(child.actor);
  expect(
    await parent.giveChildConsent({
      childId: child.childId,
      competitionId: comp.id,
      purpose: "participation",
      documentId: comp.guardianDocuments.participation!,
    })
  ).toMatchObject({ ok: true });
  expect(
    await parent.payForMyRegistration({ registrationId: child.registrationId })
  ).toMatchObject({ ok: true });
  const doc = await publishNextVersion(h, "communications");
  expect(
    await parent.giveChildConsent({
      childId: child.childId,
      purpose: "communications",
      documentId: doc.id,
    })
  ).toMatchObject({ ok: true });
  // The guardian also took part as an adult. They still answer only once.
  const messages = (await latestDocument(h.db, "messages"))!.id;
  expect(
    await parent.giveConsent({ purpose: "messages", documentId: messages })
  ).toMatchObject({ ok: true });
  const own = await parent.registerAsIndividual(adultForm(comp));
  if (!own.ok) throw Error(own.error);
  expect(
    await parent.payForMyRegistration({ registrationId: own.registrationId })
  ).toMatchObject({ ok: true });
  const without = await person(h, {
    name: "No consent",
    email: "survey-no@example.test",
    consent: false,
    registerFor: { competition: comp },
  });
  await confirmAdult(h, without.actor, comp.slug);
  const withdraw = await person(h, {
    name: "Withdraw",
    email: "survey-withdraw@example.test",
    registerFor: { competition: comp },
  });
  await confirmAdult(h, withdraw.actor, comp.slug);
  const yes = await person(h, {
    name: "Yes",
    email: "survey-yes@example.test",
    registerFor: { competition: comp },
  });
  await confirmAdult(h, yes.actor, comp.slug);
  const sole = await guardianWithChild(h, comp, { age: 11 });
  const soleParent = h.as(sole.actor);
  expect(
    await soleParent.giveChildConsent({
      childId: sole.childId,
      competitionId: comp.id,
      purpose: "participation",
      documentId: comp.guardianDocuments.participation!,
    })
  ).toMatchObject({ ok: true });
  expect(
    await soleParent.payForMyRegistration({
      registrationId: sole.registrationId,
    })
  ).toMatchObject({ ok: true });
  expect(
    await soleParent.giveChildConsent({
      childId: sole.childId,
      purpose: "communications",
      documentId: doc.id,
    })
  ).toMatchObject({ ok: true });
  const { institution } = await seedInstitution(h);
  const teacher = await signInCoordinator(h, institution.id);
  expect(
    await h.as(teacher.actor).registerInstitutionForCompetition({
      competitionId: comp.id,
      institutionId: institution.id,
    })
  ).toMatchObject({ ok: true });
  expect(
    await h
      .as(teacher.actor)
      .giveConsent({ purpose: "messages", documentId: messages })
  ).toMatchObject({ ok: true });
  await publishFixture(h, comp.id);
  const sentAt = h.clock.now();
  expect(
    await manager.saveSurvey({
      competitionId: comp.id,
      title: "Feedback",
      questions,
    })
  ).toMatchObject({ ok: true });
  expect(await manager.sendSurvey({ competitionId: comp.id })).toMatchObject({
    ok: true,
    invited: 5,
  });
  await h.as(withdraw.actor).withdrawConsent({ purpose: "messages" });
  await h.drain();
  expect(emailedToken(h, withdraw.email)).toBeUndefined();
  expect(emailedToken(h, without.email)).toBeUndefined();
  expect(emailedToken(h, teen.email)).toBeUndefined();
  expect(await h.as(teen.actor).mySurveys()).toEqual([]);
  expect(await h.as(withdraw.actor).mySurveys()).toEqual([]);
  const soleForm = await soleParent.getSurveyAnswerForm({
    competitionId: comp.id,
  });
  expect(soleForm).not.toBeNull();
  expect(
    await soleParent.withdrawChildConsent({
      childId: sole.childId,
      purpose: "communications",
    })
  ).toMatchObject({ ok: true });
  expect(
    await soleParent.answerSurvey({ competitionId: comp.id, answers: [1, 0] })
  ).toMatchObject({ ok: false, error: "unavailable" });
  const token = emailedToken(h, yes.email)!;
  expect(token).toBeTruthy();
  expect(await h.as(h.visitor()).getSurveyAnswerForm({ token })).not.toBeNull();
  h.clock.advance({ minutes: 20 });
  // The other basis (the guardian's own registration) is still valid after child withdrawal.
  expect(
    await parent.withdrawChildConsent({
      childId: child.childId,
      purpose: "communications",
    })
  ).toMatchObject({ ok: true });
  expect(await parent.mySurveys()).toHaveLength(1);
  expect(
    await parent.answerSurvey({ competitionId: comp.id, answers: [4, 0] })
  ).toEqual({ ok: true });
  expect(
    await h
      .as(teacher.actor)
      .answerSurvey({ competitionId: comp.id, answers: [2, 1] })
  ).toEqual({ ok: true });
  expect(
    await h
      .as(yes.actor)
      .answerSurvey({ competitionId: comp.id, answers: [3, 0] })
  ).toEqual({ ok: true });
  expect(await manager.getSurvey({ competitionId: comp.id })).toMatchObject({
    results: {
      invited: 4,
      responses: 3,
      counts: [
        [0, 0, 1, 1, 1],
        [2, 1],
      ],
      responseRate: 75,
    },
  });
  expect(
    await surveyFeedbackMetrics(h.db, {
      from: sentAt,
      to: new Date(sentAt.getTime() + 1000),
    })
  ).toEqual({ surveysSent: 1, invited: 4, responses: 0 });
  expect(
    await surveyFeedbackMetrics(h.db, {
      from: h.clock.now(),
      to: new Date(h.clock.now().getTime() + 1000),
    })
  ).toEqual({ surveysSent: 0, invited: 0, responses: 3 });
});

it("coalesces siblings, excludes an institution with no competition link, and refuses stale guardian and coordinator links", async () => {
  const h = await createHarness();
  await h.settings.set("surveys.enabled", true);
  const comp = await consentCompetition(h, { fee: 0n });
  const manager = h.as(await signedInWith(h, managerOf(comp.id)));
  const family = await h.seed.guardian({
    children: [
      { age: 9, fullName: "Sibling One" },
      { age: 11, fullName: "Sibling Two" },
    ],
  });
  const parent = h.as(await h.signIn(family.account));
  const doc = await publishNextVersion(h, "communications");
  for (const childId of family.childIds) {
    const reg = await parent.registerAsIndividual(
      childForm(comp, childId, { participation: true })
    );
    if (!reg.ok) throw Error(reg.error);
    expect(
      await parent.payForMyRegistration({ registrationId: reg.registrationId })
    ).toMatchObject({ ok: true });
    expect(
      await parent.giveChildConsent({
        childId,
        purpose: "communications",
        documentId: doc.id,
      })
    ).toMatchObject({ ok: true });
  }
  const { institution } = await seedInstitution(h, { name: "Linked school" });
  const teacher = await signInCoordinator(h, institution.id);
  const unrelated = await seedInstitution(h, { name: "Unrelated school" });
  const outside = await signInCoordinator(h, unrelated.institution.id);
  const messageDoc = await publishDocument(h, "messages");
  for (const coordinator of [teacher, outside])
    expect(
      await h
        .as(coordinator.actor)
        .giveConsent({ purpose: "messages", documentId: messageDoc })
    ).toMatchObject({ ok: true });
  expect(
    await h.as(teacher.actor).registerInstitutionForCompetition({
      institutionId: institution.id,
      competitionId: comp.id,
    })
  ).toMatchObject({ ok: true });
  await publishFixture(h, comp.id);
  expect(
    await manager.saveSurvey({
      competitionId: comp.id,
      title: "Feedback",
      questions,
    })
  ).toMatchObject({ ok: true });
  expect(await manager.sendSurvey({ competitionId: comp.id })).toEqual({
    ok: true,
    invited: 2,
  });
  await h.drain();
  const token = emailedToken(h, family.account.email)!;
  expect(token).toBeTruthy();
  expect(
    h.email.sent.filter(
      (m) => m.to === family.account.email && m.text.includes("/feedback/")
    )
  ).toHaveLength(1);
  expect(await h.as(outside.actor).mySurveys()).toEqual([]);
  expect(
    await h.as(outside.actor).getSurveyAnswerForm({ competitionId: comp.id })
  ).toBeNull();
  await expect(
    h.as(teacher.actor).getSurvey({ competitionId: comp.id })
  ).rejects.toMatchObject({ code: "forbidden" });
  // A previously verified guardian link has since been revoked.
  await h.db
    .update(guardianLink)
    .set({ revokedAt: h.clock.now() })
    .where(eq(guardianLink.participantProfileId, family.childIds[0]!));
  expect(await parent.mySurveys()).toHaveLength(1);
  await parent.withdrawChildConsent({
    childId: family.childIds[1]!,
    purpose: "communications",
  });
  expect(await h.as(h.visitor()).getSurveyAnswerForm({ token })).toBeNull();
  expect(
    await h.as(h.visitor()).answerSurvey({ token, answers: [1, 0] })
  ).toMatchObject({ ok: false, error: "unavailable" });
  const admin = h.as(await h.signIn(await h.seed.superAdmin()));
  expect(
    await admin.revokeRole({
      userId: teacher.userId,
      role: "institution_coordinator",
      scope: { type: "institution", id: institution.id },
    })
  ).toMatchObject({ ok: true });
  expect(
    await h
      .as(teacher.actor)
      .answerSurvey({ competitionId: comp.id, answers: [1, 0] })
  ).toMatchObject({ ok: false, error: "unavailable" });
});
it("includes survey answers in an erasure plan and removes them when the request is approved", async () => {
  const h = await createHarness();
  await h.settings.set("surveys.enabled", true);
  await h.settings.set("privacy.erasureEnabled", true);
  const comp = await consentCompetition(h, { fee: 0n });
  const manager = h.as(await signedInWith(h, managerOf(comp.id)));
  const adult = await person(h, {
    name: "Feedback erasure",
    email: "survey-erasure@example.test",
    registerFor: { competition: comp },
  });
  await confirmAdult(h, adult.actor, comp.slug);
  await publishFixture(h, comp.id);
  await manager.saveSurvey({
    competitionId: comp.id,
    title: "Feedback",
    questions,
  });
  await manager.sendSurvey({ competitionId: comp.id });
  expect(
    await h
      .as(adult.actor)
      .answerSurvey({ competitionId: comp.id, answers: [0, 0] })
  ).toEqual({ ok: true });
  const filed = await h
    .as(adult.actor)
    .submitPrivacyRequest({ type: "erasure", subject: { kind: "self" } });
  if (!filed.ok) throw Error(filed.error);
  const officer = h.as((await signedInOfficer(h)).actor);
  await officer.startPrivacyRequest({ id: filed.requestId });
  await h.drain();
  const preview = await officer.previewErasure({ id: filed.requestId });
  if (!preview.ok) throw Error(preview.error);
  expect(preview.preview.plan.categories).toContainEqual(
    expect.objectContaining({
      key: "survey_feedback",
      action: "delete",
      count: 1,
    })
  );
  expect(
    await officer.executeErasure({
      id: filed.requestId,
      fingerprint: preview.preview.plan.fingerprint,
    })
  ).toEqual({ ok: true });
  await h.drain();
  expect(await manager.getSurvey({ competitionId: comp.id })).toMatchObject({
    results: { invited: 0, responses: 0 },
  });
});
