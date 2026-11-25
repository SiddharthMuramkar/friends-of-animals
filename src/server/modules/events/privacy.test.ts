import { expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { staffActor } from "../volunteers/testing";
import { details } from "./testing";
import { collectSubjectData } from "../privacy/requests/subject-data/collect";
import { subjectScope } from "../privacy/requests/subject-data/scope";
import { signedInOfficer } from "../privacy/requests/testing";

it("exports only the correct attendee and frees an erased person's place without exposing the next person", async () => {
  const h = await createHarness();
  await h.settings.set("privacy.erasureEnabled", true);
  const staff = h.as(await staffActor(h, "community_manager"));
  const a = await h.seed.member();
  const b = await h.seed.member();
  const ap = h.as(await h.signIn(a));
  const bp = h.as(await h.signIn(b));
  const made = await staff.createEvent(
    details(h.clock.now(), { capacity: 1, audience: "signed_in" })
  );
  if (!made.ok) throw Error(made.error);
  const eventId = made.eventId;
  await staff.publishEvent({ eventId });
  const first = await ap.registerForEvent({ eventId });
  const second = await bp.registerForEvent({ eventId });
  if (!first.ok || !second.ok) throw Error("booking failed");
  const exportFor = async (subjectId: string) =>
    (
      await collectSubjectData(h.deps, {
        scope: await subjectScope(h.db, { subjectKind: "user", subjectId }),
        subject: { kind: "user", id: subjectId },
        reference: "EVENT-EXPORT",
        generatedAt: h.clock.now(),
      })
    ).document.sections.event_registration;
  expect(await exportFor(a.id)).toMatchObject([
    { id: first.registrationId, event_id: eventId, status: "registered" },
  ]);
  expect(await exportFor(b.id)).toMatchObject([
    { id: second.registrationId, event_id: eventId, status: "waitlisted" },
  ]);
  const filed = await ap.submitPrivacyRequest({
    type: "erasure",
    subject: { kind: "self" },
  });
  if (!filed.ok) throw Error(filed.error);
  const officer = h.as((await signedInOfficer(h)).actor);
  await officer.startPrivacyRequest({ id: filed.requestId });
  await h.drain();
  const preview = await officer.previewErasure({ id: filed.requestId });
  if (!preview.ok) throw Error(preview.error);
  expect(
    preview.preview.plan.categories.find((c) => c.key === "community_history")
  ).toMatchObject({ action: "delete", count: 1 });
  expect(
    await officer.executeErasure({
      id: filed.requestId,
      fingerprint: preview.preview.plan.fingerprint,
    })
  ).toMatchObject({ ok: true });
  await h.drain();
  expect(await staff.listEventRegistrations({ eventId })).toMatchObject({
    ok: true,
    items: [{ id: second.registrationId, status: "registered" }],
  });
  expect(await bp.listMyEventRegistrations()).toMatchObject([
    { status: "registered" },
  ]);
  expect(await exportFor(a.id)).toEqual([]);
});
