import { describe, expect, it } from "vitest";

import { createHarness, type Harness } from "@/test/harness";
import type { Actor } from "@/server/actor";
import { signInStaff } from "../../payments/testing";
import { openDonations, receiptTokenSentTo } from "../testing";
import type { RecordOfflineDonationInput } from "./record";

const CHEQUE_SCAN = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj\n<<>>\nendobj\n"
);

async function upload(h: Harness, actor: Actor) {
  const request = await h.as(actor).requestOfflineDonationProofUpload({
    contentType: "application/pdf",
    sizeBytes: CHEQUE_SCAN.length,
  });
  if (!request.ok) throw new Error(request.error);
  expect(
    await h.storage.put(request.uploadUrl, CHEQUE_SCAN, request.headers)
  ).toMatchObject({ ok: true });
  expect(
    await h.as(actor).completeUpload({ fileId: request.fileId })
  ).toMatchObject({ ok: true });
  return request.fileId;
}

function entry(
  proofFileId: string,
  overrides: Partial<RecordOfflineDonationInput> = {}
): RecordOfflineDonationInput {
  return {
    method: "cheque",
    reference: "001234",
    receivedOn: "2027-01-14",
    amountMinor: 50_000n,
    donorType: "individual",
    name: "Asha Rao",
    email: "asha@example.test",
    proofFileId,
    declaredAdult: true,
    declaredIndianSource: true,
    ...overrides,
  };
}

describe("recordOfflineDonation", () => {
  it("records the money received exactly once with one numbered receipt and one posting", async () => {
    const h = await createHarness();
    await openDonations(h);
    const finance = (await signInStaff(h, "finance")).actor;
    const proofFileId = await upload(h, finance);
    const first = await h.as(finance).recordOfflineDonation(entry(proofFileId));
    expect(first).toMatchObject({
      ok: true,
      receiptNumber: "FOA-RCPT-2627-000001",
    });
    if (!first.ok) return;
    expect(
      await h.as(finance).recordOfflineDonation(entry(proofFileId))
    ).toMatchObject({ ok: false, error: "proof_already_used" });
    const second = await h.as(finance).recordOfflineDonation(
      entry(await upload(h, finance), {
        method: "cash",
        reference: "FOA-2027-1",
        email: "other@example.test",
      })
    );
    expect(second).toMatchObject({
      ok: true,
      receiptNumber: "FOA-RCPT-2627-000002",
    });
    await h.drain();
    await h
      .as({ kind: "system", process: "worker" })
      .backfillLedgerFromPayments();
    const ledger = await h.as(finance).listPostings({});
    expect(ledger).toMatchObject({
      ok: true,
      postings: [
        { sourceType: "donation", debitMinor: 50_000n, creditMinor: 50_000n },
        { sourceType: "donation", debitMinor: 50_000n, creditMinor: 50_000n },
      ],
    });
    const bank = await h.as(finance).listPostings({ accountCode: "1000" });
    expect(bank).toMatchObject({
      ok: true,
      postings: [{ debitMinor: 50_000n }],
    });
    expect(
      await h.as(finance).listPostings({ accountCode: "1010" })
    ).toMatchObject({ ok: true, postings: [{ debitMinor: 50_000n }] });
    const detail = await h
      .as(finance)
      .getDonation({ donationId: first.donationId });
    expect(detail).toMatchObject({
      ok: true,
      donation: {
        status: "captured",
        receiptNumber: "FOA-RCPT-2627-000001",
        offline: {
          method: "cheque",
          reference: "001234",
          receivedOn: "2027-01-14",
          proofStatus: "clean",
        },
      },
    });
    const receipt = await h.as(h.visitor()).getReceiptByToken({
      token: receiptTokenSentTo(h, "other@example.test"),
    });
    expect(receipt).toMatchObject({
      ok: true,
      receipt: {
        snapshot: {
          taxExemption: null,
          payment: {
            mode: "cash",
            reference: "FOA-2027-1",
            receivedOn: "2027-01-14",
          },
        },
      },
    });
  });
});

describe("offline proof and entry access", () => {
  it("only finance with a fresh factor can upload and record; only finance can read a clean proof", async () => {
    const h = await createHarness();
    await openDonations(h);
    const finance = (await signInStaff(h, "finance")).actor;
    const member = await h.signIn(await h.seed.member());
    const admin = await h.signIn(await h.seed.superAdmin());
    const uploadInput = {
      contentType: "application/pdf",
      sizeBytes: CHEQUE_SCAN.length,
    };
    expect(await h.as(finance).getOfflineDonationTerms()).toMatchObject({
      open: true,
      has80G: false,
      today: "2027-01-15",
    });
    const proofFileId = await upload(h, finance);
    for (const actor of [member, admin, h.visitor()]) {
      await expect(h.as(actor).getOfflineDonationTerms()).rejects.toMatchObject(
        { code: "forbidden" }
      );
      await expect(
        h.as(actor).requestOfflineDonationProofUpload(uploadInput)
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        h.as(actor).recordOfflineDonation(entry(proofFileId))
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    expect(
      await h
        .as(finance)
        .requestUpload({ purpose: "offline_donation_proof", ...uploadInput })
    ).toMatchObject({ ok: false, error: "purpose_unavailable" });
    h.clock.advance({ minutes: 11 });
    await expect(
      h.as(finance).recordOfflineDonation(entry(proofFileId))
    ).rejects.toMatchObject({ code: "step_up_required" });
    await h.passSecondFactor(finance);
    const recorded = await h
      .as(finance)
      .recordOfflineDonation(entry(proofFileId));
    if (!recorded.ok) throw new Error(recorded.error);
    const input = { donationId: recorded.donationId };
    expect(await h.as(finance).getOfflineDonationProof(input)).toMatchObject({
      ok: false,
      error: "file_unavailable",
    });
    await h.drain();
    const colleague = (await signInStaff(h, "finance")).actor;
    const proof = await h.as(colleague).getOfflineDonationProof(input);
    if (!proof.ok) throw new Error(proof.error);
    expect(await h.storage.get(proof.url)).toMatchObject({
      ok: true,
      bytes: CHEQUE_SCAN,
    });
    for (const actor of [member, admin, h.visitor()]) {
      await expect(
        h.as(actor).getOfflineDonationProof(input)
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    expect(
      await h.as(admin).getFileDownloadUrl({ fileId: proofFileId })
    ).toEqual({ ok: false, error: "not_found" });
    await expect(
      h.as(finance).getFileDownloadUrl({ fileId: proofFileId })
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("checks date, reference and PAN when the organisation has 80G", async () => {
    const h = await createHarness();
    await openDonations(h);
    await h.settings.set("org.has80G", true);
    const finance = (await signInStaff(h, "finance")).actor;
    const proofFileId = await upload(h, finance);
    const staff = h.as(finance);
    expect(await staff.getOfflineDonationTerms()).toMatchObject({
      has80G: true,
    });
    expect(await staff.recordOfflineDonation(entry(proofFileId))).toMatchObject(
      { ok: false, fields: ["pan"] }
    );
    expect(
      await staff.recordOfflineDonation(
        entry(proofFileId, {
          receivedOn: "2027-01-16",
          reference: "wrong",
          pan: "ABCDE1234F",
        })
      )
    ).toMatchObject({ ok: false, fields: ["reference", "receivedOn"] });
    expect(
      await staff.recordOfflineDonation(
        entry(proofFileId, {
          pan: "ABCDE1234F",
          method: "bank_transfer",
          reference: "ABC123456789",
        })
      )
    ).toMatchObject({ ok: true, receiptNumber: "FOA-RCPT-2627-000001" });
    await h.drain();
    expect(
      await h.as(h.visitor()).getReceiptByToken({
        token: receiptTokenSentTo(h, "asha@example.test"),
      })
    ).toMatchObject({
      ok: true,
      receipt: {
        snapshot: {
          taxExemption: { scheme: "80G", donorPanMasked: "******234F" },
          payment: { mode: "bank_transfer" },
        },
      },
    });
  });
});
