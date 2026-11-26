import { expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import {
  consentCompetition,
  guardianWithChild,
  publishNextVersion,
} from "../consent/testing";
import { publishFixture } from "../surveys/testing";
import { signedInOfficer } from "../privacy/requests/testing";
import { collectSubjectData } from "../privacy/requests/subject-data/collect";
import { subjectScope } from "../privacy/requests/subject-data/scope";
import { competitionInvitation } from "../../db/schema";

it("keeps child invitation details out of the guardian's own export and erases them with the child", async () => {
  const h = await createHarness();
  await h.settings.set("invitations.enabled", true);
  await h.settings.set("privacy.erasureEnabled", true);
  const comp = await consentCompetition(h, { fee: 0n });
  const child = await guardianWithChild(h, comp, { age: 10 });
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
  await publishFixture(h, comp.id);
  await h.drain();
  const [invite] = await parent.myCompetitionInvitations();
  expect(
    await parent.acceptCompetitionInvitation({
      invitationId: invite!.id,
      action: "join_community",
    })
  ).toMatchObject({ ok: true });
  async function exported(kind: "user" | "participant_profile", id: string) {
    const { document } = await collectSubjectData(h.deps, {
      scope: await subjectScope(h.db, { subjectKind: kind, subjectId: id }),
      subject: { kind, id },
      reference: "INVITE-EXPORT",
      generatedAt: h.clock.now(),
    });
    return document.sections.competition_invitation;
  }
  const own = await exported("user", child.userId);
  expect(own).toMatchObject([{ id: invite!.id, status: "sent" }]);
  expect(own?.[0]).not.toHaveProperty("participant_profile_id");
  expect(own?.[0]).not.toHaveProperty("accepted_actions");
  const childData = await exported("participant_profile", child.childId);
  expect(childData).toMatchObject([
    { id: invite!.id, accepted_actions: ["join_community"] },
  ]);
  expect(childData?.[0]).not.toHaveProperty("recipient_user_id");
  const filed = await parent.submitPrivacyRequest({
    type: "erasure",
    subject: { kind: "child", childId: child.childId },
  });
  if (!filed.ok) throw Error(filed.error);
  const officer = h.as((await signedInOfficer(h)).actor);
  expect(
    await officer.startPrivacyRequest({ id: filed.requestId })
  ).toMatchObject({ ok: true });
  const plan = await officer.previewErasure({ id: filed.requestId });
  if (!plan.ok) throw Error(plan.error);
  expect(
    await officer.executeErasure({
      id: filed.requestId,
      fingerprint: plan.preview.plan.fingerprint,
    })
  ).toMatchObject({ ok: true });
  await h.drain();
  expect(await h.db.select().from(competitionInvitation)).toEqual([]);
  expect(await parent.myCompetitionInvitations()).toEqual([]);
});
