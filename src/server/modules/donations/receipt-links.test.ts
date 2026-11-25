import { describe, expect, it } from "vitest";

import { receiptLink } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { createHarness, type Harness } from "@/test/harness";

import {
  capturedDonation,
  openDonations,
  receiptTokenSentTo,
  startedDonation,
} from "./testing";

async function financeUser(h: Harness) {
  const account = await h.seed.member({ email: "finance@example.test" });
  await h.seed.grant(account, { role: "finance", scope: { type: "global" } });
  return h.signIn(account);
}

const RECEIPT_EMAIL = "Your receipt FOA-RCPT-2627-000001";

describe("getReceiptByToken", () => {
  it("opens the frozen receipt for 7 days, then says the link expired", async () => {
    const h = await createHarness();
    await openDonations(h);
    await capturedDonation(h);
    const token = receiptTokenSentTo(h, "asha@example.test");

    const opened = await h.as(h.visitor()).getReceiptByToken({ token });
    expect(opened).toMatchObject({
      ok: true,
      receipt: {
        snapshot: { number: "FOA-RCPT-2627-000001" },
        cancelledAt: null,
      },
    });

    h.clock.advance({ days: 7, seconds: -1 });
    expect((await h.as(h.visitor()).getReceiptByToken({ token })).ok).toBe(
      true
    );
    h.clock.advance({ seconds: 1 });
    expect(await h.as(h.visitor()).getReceiptByToken({ token })).toEqual({
      ok: false,
      error: "expired",
    });
  });

  it.each([
    ["malformed", "not-a-token"],
    ["unknown", "A".repeat(43)],
  ])("finds nothing for a %s token", async (_, token) => {
    const h = await createHarness();
    expect(await h.as(h.visitor()).getReceiptByToken({ token })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("shows the receipt as issued after FOA's facts change", async () => {
    const h = await createHarness();
    await openDonations(h);
    await h.settings.set("org.legalName", "Friends of Animals Trust");
    await capturedDonation(h);
    const token = receiptTokenSentTo(h, "asha@example.test");

    await h.settings.set("org.legalName", "Another Name Entirely");
    await h.settings.set("org.pan", "AAAAA0000A");

    expect(await h.as(h.visitor()).getReceiptByToken({ token })).toMatchObject({
      ok: true,
      receipt: {
        snapshot: {
          org: {
            legalName: "Friends of Animals Trust",
            registration: { pan: null },
          },
        },
      },
    });
  });
});

describe("reissueReceiptLink", () => {
  it("emails the signed-in donor a new link; the old one stays expired", async () => {
    const h = await createHarness();
    await openDonations(h);
    const member = await h.seed.member({ email: "meera@example.test" });
    const donor = await h.signIn(member);
    const { donationId } = await capturedDonation(
      h,
      { email: "meera@example.test" },
      donor
    );
    const first = receiptTokenSentTo(h, "meera@example.test");
    h.clock.advance({ days: 8 });

    expect(await h.as(donor).reissueReceiptLink({ donationId })).toEqual({
      ok: true,
      issuedTo: "donor",
    });
    await h.drain();

    expect(h.email.lastTo("meera@example.test")?.subject).toBe(RECEIPT_EMAIL);
    const fresh = receiptTokenSentTo(h, "meera@example.test");
    expect(fresh).not.toBe(first);
    expect(
      (await h.as(h.visitor()).getReceiptByToken({ token: fresh })).ok
    ).toBe(true);
    expect(await h.as(h.visitor()).getReceiptByToken({ token: first })).toEqual(
      { ok: false, error: "expired" }
    );
  });

  it("hands finance a link on screen and mails nothing", async () => {
    const h = await createHarness();
    await openDonations(h);
    const { donationId } = await capturedDonation(h);
    const finance = await financeUser(h);
    const emailsBefore = h.email.sent.length;

    const result = await h.as(finance).reissueReceiptLink({ donationId });

    expect(result).toEqual({
      ok: true,
      issuedTo: "finance",
      path: expect.stringMatching(/^\/receipts\/[A-Za-z0-9_-]{43}$/),
      expiresAt: new Date(h.clock.now().getTime() + 7 * 24 * 3600 * 1000),
    });
    await h.drain();
    expect(h.email.sent.length).toBe(emailsBefore);
    if (!result.ok || result.issuedTo !== "finance") return;
    const token = result.path.split("/").at(-1)!;
    expect((await h.as(h.visitor()).getReceiptByToken({ token })).ok).toBe(
      true
    );
    const links = await h.db.select().from(receiptLink);
    expect(links.map((link) => link.issuedTo).sort()).toEqual([
      "donor",
      "finance",
    ]);
  });

  it("refuses another member, a guest donor's visitor and other staff", async () => {
    const h = await createHarness();
    await openDonations(h);
    const { donationId } = await capturedDonation(h);
    const someone = await h.signIn(await h.seed.member());
    const admin = await h.seed.member({ email: "admin@example.test" });
    await h.seed.grant(admin, {
      role: "super_admin",
      scope: { type: "global" },
    });

    for (const actor of [someone, h.visitor(), await h.signIn(admin)]) {
      await expect(
        h.as(actor).reissueReceiptLink({ donationId })
      ).rejects.toThrow(DomainError);
    }
  });

  it("says a donation without a receipt has none", async () => {
    const h = await createHarness();
    await openDonations(h);
    const { donationId } = await startedDonation(h);
    const finance = await financeUser(h);

    expect(await h.as(finance).reissueReceiptLink({ donationId })).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("requestReceiptLinkByEmail", () => {
  it("emails a new link when the email and receipt number match, and answers alike when not", async () => {
    const h = await createHarness();
    await openDonations(h);
    await capturedDonation(h);
    const sentBefore = h.email.sent.length;

    for (const attempt of [
      { email: "someone@example.test", receiptNumber: "FOA-RCPT-2627-000001" },
      { email: "asha@example.test", receiptNumber: "FOA-RCPT-2627-000009" },
      { email: "asha@example.test", receiptNumber: "nonsense" },
    ]) {
      expect(
        await h.as(h.visitor()).requestReceiptLinkByEmail(attempt)
      ).toEqual({ ok: true });
    }
    await h.drain();
    expect(h.email.sent.length).toBe(sentBefore);

    expect(
      await h.as(h.visitor()).requestReceiptLinkByEmail({
        email: " Asha@Example.test ",
        receiptNumber: "foa-rcpt-2627-000001",
      })
    ).toEqual({ ok: true });
    await h.drain();
    expect(h.email.lastTo("asha@example.test")?.subject).toBe(RECEIPT_EMAIL);
  });

  it("limits how often one address may ask", async () => {
    const h = await createHarness();
    const ask = () =>
      h.as(h.visitor()).requestReceiptLinkByEmail({
        email: "asha@example.test",
        receiptNumber: "FOA-RCPT-2627-000001",
      });

    for (let i = 0; i < 5; i++) expect(await ask()).toEqual({ ok: true });
    expect(await ask()).toMatchObject({ ok: false, error: "rate_limited" });
    h.clock.advance({ hours: 1 });
    expect(await ask()).toEqual({ ok: true });
  });

  it("refuses the platform's own processes", async () => {
    const h = await createHarness();
    await expect(
      h.as({ kind: "system", process: "worker" }).requestReceiptLinkByEmail({
        email: "asha@example.test",
        receiptNumber: "FOA-RCPT-2627-000001",
      })
    ).rejects.toThrow(DomainError);
  });
});
