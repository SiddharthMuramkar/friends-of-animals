// A campaign message's withdrawal link (#126): opening it changes nothing;
// withdrawing by it withdraws the consent the message rested on, through
// the consent log, and the person is out of every later send.
import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";
import { consentCompetition } from "@/server/modules/consent/testing";
import { createHarness, type Harness } from "@/test/harness";

import {
  campaignAudit,
  communityManager,
  draftCampaign,
  guardianOfChild,
  person,
  SAMPLE_CONTENT,
  sendDraft,
  withdrawalTokenIn,
} from "./testing";

async function sendToEveryone(
  h: Harness,
  manager: Awaited<ReturnType<typeof communityManager>>,
  content = SAMPLE_CONTENT
) {
  const draft = await draftCampaign(h, manager, {}, content);
  await sendDraft(h, manager, draft);
  await h.drain();
  return draft;
}

describe("the withdrawal link", () => {
  it("withdraws the person's consent to News and updates, and keeps them out of later sends", async () => {
    const h = await createHarness();
    const manager = await communityManager(h);
    const asha = await person(h, {
      name: "Asha Rao",
      email: "asha@example.test",
    });
    const first = await sendToEveryone(h, manager);
    const token = withdrawalTokenIn(h, asha.email);
    const visitor = h.visitor();

    expect(await h.as(visitor).viewWithdrawalLink({ token })).toEqual({
      ok: true,
      status: "open",
      ownConsent: true,
      children: 0,
    });
    // Opening the link (a mail scanner may) changes nothing.
    const [beforeConsent] = await h.as(asha.actor).myConsents();
    expect(beforeConsent?.state.status).toBe("given");

    expect(await h.as(visitor).withdrawByLink({ token })).toEqual({
      ok: true,
      changed: true,
    });

    const [messages] = await h.as(asha.actor).myConsents();
    expect(messages?.state.status).toBe("withdrawn");
    expect(await h.as(visitor).viewWithdrawalLink({ token })).toEqual({
      ok: true,
      status: "done",
    });
    expect(await h.as(visitor).withdrawByLink({ token })).toEqual({
      ok: true,
      changed: false,
    });
    expect((await campaignAudit(h, first.id)).at(-1)).toMatchObject({
      action: "campaign.withdrawal_link_used",
      actorRole: null,
      after: { withdrawn: 1 },
    });

    h.clock.advance({ days: 1 });
    const later = { subject: "Volunteer day", body: "Join us." };
    const ravi = await person(h, {
      name: "Ravi Iyer",
      email: "ravi@example.test",
    });
    const second = await draftCampaign(h, manager, {}, later);
    const sent = await sendDraft(h, manager, second);
    await h.drain();
    expect(sent.counts.recipients).toBe(1);
    expect(
      h.email.sent.filter((m) => m.subject === later.subject).map((m) => m.to)
    ).toEqual([ravi.email]);
  });

  it("stops the campaign's other waiting message to the same person", async () => {
    const h = await createHarness();
    const manager = await communityManager(h);
    const asha = await person(h, {
      name: "Asha Rao",
      email: "asha@example.test",
    });
    await sendToEveryone(h, manager);
    const token = withdrawalTokenIn(h, asha.email);
    const second = await draftCampaign(
      h,
      manager,
      {},
      {
        subject: "Second",
        body: "Again",
      }
    );
    await sendDraft(h, manager, second);

    await h.as(h.visitor()).withdrawByLink({ token });
    await h.drain();

    expect(h.email.sent.filter((m) => m.subject === "Second")).toEqual([]);
  });

  it("withdraws a guardian's consent to messages about their child, by the guardian's link", async () => {
    const h = await createHarness();
    const manager = await communityManager(h);
    const competition = await consentCompetition(h, { fee: 0n });
    const guardian = await guardianOfChild(h, {
      name: "Gita Guardian",
      email: "gita@example.test",
      competition,
    });
    await sendToEveryone(h, manager);
    const token = withdrawalTokenIn(h, guardian.email);

    expect(await h.as(guardian.actor).viewWithdrawalLink({ token })).toEqual({
      ok: true,
      status: "open",
      ownConsent: false,
      children: 1,
    });
    expect(await h.as(guardian.actor).withdrawByLink({ token })).toEqual({
      ok: true,
      changed: true,
    });

    const consents = await h
      .as(guardian.actor)
      .childConsents({ childId: guardian.childId });
    expect(consents.ok && consents.communications.state.status).toBe(
      "withdrawn"
    );
  });

  it("answers not_found for a link it never sent", async () => {
    const h = await createHarness();
    const visitor = h.visitor();

    for (const token of ["", "not-a-token", "a".repeat(64)]) {
      expect(await h.as(visitor).viewWithdrawalLink({ token })).toEqual({
        ok: false,
        error: "not_found",
      });
      expect(await h.as(visitor).withdrawByLink({ token })).toEqual({
        ok: false,
        error: "not_found",
      });
    }
  });

  it("is for whoever holds the link, not the platform's own processes", async () => {
    const h = await createHarness();
    const manager = await communityManager(h);
    const asha = await person(h, {
      name: "Asha Rao",
      email: "asha@example.test",
    });
    await sendToEveryone(h, manager);
    const token = withdrawalTokenIn(h, asha.email);
    const worker = { kind: "system", process: "worker" } as const;

    await expect(
      h.as(worker).viewWithdrawalLink({ token })
    ).rejects.toBeInstanceOf(DomainError);
    await expect(h.as(worker).withdrawByLink({ token })).rejects.toBeInstanceOf(
      DomainError
    );
    const [messages] = await h.as(asha.actor).myConsents();
    expect(messages?.state.status).toBe("given");
  });
});
