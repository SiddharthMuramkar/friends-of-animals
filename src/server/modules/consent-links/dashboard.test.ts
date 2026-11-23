import { expect, it } from "vitest";

import { consentLink, outbox } from "@/server/db/schema";
import { createHarness } from "@/test/harness";
import { seedInstitution } from "@/test/institutions";
import { signInCoordinator } from "@/server/modules/registration/testing";

import { consentLinkWorld, deliveredToken, GUARDIAN_EMAIL } from "./testing";

it("reports each dashboard state as the guardian verifies and answers", async () => {
  const h = await createHarness();
  const world = await consentLinkWorld(h);
  const { institutionId, registrationId } = world;
  const query = { institutionId, registrationId };
  const rowIs = async (expected: object) => {
    const list = await world.coordinator.listStudentConsents(query);
    expect(list).toMatchObject({
      ok: true,
      students: [
        { studentId: world.studentId, name: "Aanya Rao", ...expected },
      ],
    });
  };
  await rowIs({
    link: "not_sent",
    publicUse: "none",
    given: [],
    canSendLink: true,
  });
  const contact = await world.coordinator.listStudentConsents({
    institutionId,
    reference: world.reference,
    contactFor: world.studentId,
  });
  expect(contact).toMatchObject({
    ok: true,
    suggestedContact: { email: "kavita.rao@example.test" },
  });
  const sent = await world.coordinator.sendConsentLink(world.send);
  if (!sent.ok) throw new Error("Could not send a synthetic link");
  await h.drain();
  const token = deliveredToken(h);
  const visitor = h.as(h.visitor());
  await visitor.viewConsentLink({ token });
  await rowIs({ link: "sent" });
  await visitor.sendConsentLinkCode({ token });
  await rowIs({ link: "opened" });
  const code = h.email.codeFor(GUARDIAN_EMAIL);
  if (!code) throw new Error("No synthetic code arrived");
  const verified = await visitor.verifyConsentLinkCode({ token, code });
  if (!verified.ok) throw new Error("Could not verify the synthetic code");
  await rowIs({ link: "verified", canSendLink: false });
  expect(await world.coordinator.sendConsentLink(world.send)).toEqual({
    ok: false,
    error: "already_verified",
  });
  await visitor.answerConsentLink({
    token,
    sessionToken: verified.sessionToken,
    answers: { public_display: "give", social_media: "decline" },
  });
  await rowIs({
    link: "answered",
    publicUse: "some",
    given: ["public_display"],
    canSendLink: true,
  });

  const next = await world.coordinator.sendConsentLink(world.send);
  if (!next.ok) throw new Error("Could not send the replacement link");
  await rowIs({ link: "sent" });
  h.clock.advance({ days: 7 });
  await rowIs({ link: "expired" });
  expect(
    await world.coordinator.revokeConsentLink({ ...query, linkId: next.linkId })
  ).toEqual({ ok: true });
  await rowIs({ link: "revoked" });
});

it("allows the school's authorised person and denies outsiders at every coordinator use case", async () => {
  const h = await createHarness();
  const world = await consentLinkWorld(h);
  const { institution } = await seedInstitution(h, { name: "Other School" });
  const other = await signInCoordinator(h, institution.id);
  const { account } = await h.seed.guardian({ children: [] });
  const guardian = await h.signIn(account);
  const member = await h.signIn(await h.seed.member());
  const authorised = h.as(await h.signIn(world.admin));
  const sent = await authorised.sendConsentLink(world.send);
  if (!sent.ok)
    throw new Error("The school's authorised person could not send");
  const { institutionId, registrationId } = world;
  const query = { institutionId, registrationId };
  const revoke = { ...query, linkId: sent.linkId };
  const before = await h.db.select({ id: outbox.id }).from(outbox);
  for (const actor of [h.visitor(), other.actor, guardian, member]) {
    const outsider = h.as(actor);
    await expect(outsider.sendConsentLink(world.send)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(outsider.revokeConsentLink(revoke)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(outsider.listStudentConsents(query)).rejects.toMatchObject({
      code: "forbidden",
    });
  }
  expect(await h.db.select({ id: outbox.id }).from(outbox)).toEqual(before);
  expect(
    await h.db.select({ status: consentLink.status }).from(consentLink)
  ).toEqual([{ status: "pending" }]);

  await h.drain();
  const token = deliveredToken(h);
  expect(await authorised.listStudentConsents(query)).toMatchObject({
    ok: true,
    students: [{ link: "sent" }],
  });
  expect(await authorised.revokeConsentLink(revoke)).toEqual({ ok: true });
  const visitor = h.as(h.visitor());
  expect(await visitor.viewConsentLink({ token })).toEqual({
    status: "revoked",
  });
  expect(await visitor.sendConsentLinkCode({ token })).toEqual({
    ok: false,
    error: "revoked",
  });
});

it("checks coordinator scope before lookup and keeps registrations inside that scope", async () => {
  const h = await createHarness();
  const world = await consentLinkWorld(h);
  const { institution } = await seedInstitution(h, { name: "Other School" });
  const other = h.as((await signInCoordinator(h, institution.id)).actor);
  const issued = await world.coordinator.sendConsentLink(world.send);
  if (!issued.ok) throw new Error("Could not issue the synthetic link");

  const missing = {
    institutionId: world.institutionId,
    registrationId: "00000000-0000-4000-8000-000000000001",
  };
  const missingReference = {
    institutionId: world.institutionId,
    reference: "TEST26-I-00000",
  };
  const forbidden = { code: "forbidden" };
  const malformed = { ...missing, registrationId: "invalid" };
  await expect
    .soft(other.sendConsentLink({ ...world.send, ...malformed }))
    .rejects.toMatchObject(forbidden);
  await expect
    .soft(other.revokeConsentLink({ ...malformed, linkId: issued.linkId }))
    .rejects.toMatchObject(forbidden);
  await expect
    .soft(other.listStudentConsents(malformed))
    .rejects.toMatchObject(forbidden);
  expect(await world.coordinator.listStudentConsents(malformed)).toMatchObject({
    ok: false,
    error: "invalid_input",
  });
  await expect
    .soft(other.sendConsentLink({ ...world.send, ...missing }))
    .rejects.toMatchObject(forbidden);
  await expect
    .soft(other.revokeConsentLink({ ...missing, linkId: issued.linkId }))
    .rejects.toMatchObject(forbidden);
  await expect
    .soft(other.listStudentConsents(missing))
    .rejects.toMatchObject(forbidden);
  await expect
    .soft(other.listStudentConsents(missingReference))
    .rejects.toMatchObject(forbidden);

  const wrongScope = {
    institutionId: institution.id,
    registrationId: world.registrationId,
  };
  const wrongReference = {
    institutionId: institution.id,
    reference: world.reference,
  };
  const notFound = { ok: false, error: "not_found" };
  await expect
    .soft(other.sendConsentLink({ ...world.send, ...wrongScope }))
    .resolves.toEqual(notFound);
  await expect
    .soft(other.revokeConsentLink({ ...wrongScope, linkId: issued.linkId }))
    .resolves.toEqual(notFound);
  await expect
    .soft(other.listStudentConsents(wrongScope))
    .resolves.toEqual(notFound);
  await expect
    .soft(other.listStudentConsents(wrongReference))
    .resolves.toEqual(notFound);
});

it("keeps school code links inactive in production even with SMS enabled and fixture copy present", async () => {
  const h = await createHarness({ appEnv: "production" });
  const world = await consentLinkWorld(h);
  await h.settings.set("sms.enabled", true);
  expect(await world.coordinator.sendConsentLink(world.send)).toEqual({
    ok: false,
    error: "unavailable",
  });
  expect(
    await world.coordinator.listStudentConsents({
      institutionId: world.institutionId,
      registrationId: world.registrationId,
    })
  ).toEqual({
    ok: false,
    error: "unavailable",
  });
  expect(await h.db.select().from(consentLink)).toHaveLength(0);
});
