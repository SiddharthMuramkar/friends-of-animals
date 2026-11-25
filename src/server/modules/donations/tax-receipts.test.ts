import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { auditLog, donor, receipt } from "@/server/db/schema";
import {
  capturedDonation,
  donationForm,
  openDonations,
  receiptTokenSentTo,
} from "./testing";

const PAN = "ABCDE1234F";

describe("80G receipts", () => {
  it("asks for PAN only while enabled, encrypts it and freezes the tax wording", async () => {
    const h = await createHarness();
    await openDonations(h);
    const visitor = h.as(h.visitor());
    expect(await visitor.getDonationTerms()).toMatchObject({ has80G: false });
    await capturedDonation(h, { pan: PAN });
    const old = receiptTokenSentTo(h, "asha@example.test");
    expect(await visitor.getReceiptByToken({ token: old })).toMatchObject({
      ok: true,
      receipt: { snapshot: { taxExemption: null } },
    });
    expect(await h.db.select({ pan: donor.pan }).from(donor)).toEqual([
      { pan: null },
    ]);

    const admin = await h.signIn(await h.seed.superAdmin());
    h.clock.advance({ minutes: 11 });
    await expect(
      h.as(admin).changeSetting({ key: "org.has80G", value: true })
    ).rejects.toMatchObject({ code: "step_up_required" });
    await h.passSecondFactor(admin);
    expect(
      await h.as(admin).changeSetting({ key: "org.has80G", value: true })
    ).toEqual({ ok: true, changed: true });
    expect(
      await h.db
        .select({ before: auditLog.before, after: auditLog.after })
        .from(auditLog)
        .where(eq(auditLog.entityId, "org.has80G"))
    ).toEqual([
      { before: { value: false, source: "default" }, after: { value: true } },
    ]);
    expect(await visitor.getDonationTerms()).toMatchObject({ has80G: true });
    expect(await visitor.startDonation(donationForm())).toMatchObject({
      ok: false,
      error: "invalid_input",
      fields: ["pan"],
    });
    expect(
      await visitor.startDonation(donationForm({ pan: "invalid" }))
    ).toMatchObject({ ok: false, error: "invalid_input", fields: ["pan"] });
    await capturedDonation(h, {
      email: "tax@example.test",
      pan: PAN.toLowerCase(),
    });
    const tax = receiptTokenSentTo(h, "tax@example.test");
    const taxReceipt = await visitor.getReceiptByToken({ token: tax });
    expect(taxReceipt).toMatchObject({
      ok: true,
      receipt: {
        snapshot: {
          taxExemption: { scheme: "80G", donorPanMasked: "******234F" },
        },
      },
    });
    const donors = await h.db.select({ pan: donor.pan }).from(donor);
    expect(donors).toHaveLength(2);
    const stored = donors.find((d) => d.pan !== null)?.pan;
    expect(stored).toBeTruthy();
    expect(stored).not.toContain(PAN);
    expect(h.deps.cipher.decrypt("donor.pan", stored!)).toBe(PAN);
    expect(
      JSON.stringify(
        await h.db.select({ snapshot: receipt.snapshot }).from(receipt)
      )
    ).not.toContain(PAN);
    expect(JSON.stringify(await h.db.select().from(auditLog))).not.toContain(
      PAN
    );

    await h.as(admin).changeSetting({ key: "org.has80G", value: false });
    expect(await visitor.getReceiptByToken({ token: tax })).toEqual(taxReceipt);
    expect(await visitor.getReceiptByToken({ token: old })).toMatchObject({
      ok: true,
      receipt: { snapshot: { taxExemption: null } },
    });
  });
});
