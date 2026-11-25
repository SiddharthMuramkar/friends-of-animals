import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createHarness } from "@/test/harness";
import { auditLog, entryVerification, user } from "@/server/db/schema";
import {
  individualEntryAtFoa,
  schoolEntriesAtFoa,
  signedInVerifier,
  statusOf,
} from "./testing";
import {
  submittedImage,
  confirmedAdult,
  essayOf,
  ENTRY_TEXT,
} from "@/server/modules/entries/testing";

describe("FOA decisions", () => {
  it("allows a verifier to inspect and verify entries from both routes, with an audit and notification", async () => {
    const h = await createHarness();
    const individual = await individualEntryAtFoa(h);
    const school = await schoolEntriesAtFoa(h);
    const verifier = await signedInVerifier(h);
    const id = school.entryIds[1]!;
    for (const entryId of [individual.entryId, id]) {
      const details = await h.as(verifier).getVerificationEntry({ entryId });
      expect(details).toMatchObject({
        ok: true,
        entry: { picture: { url: expect.any(String) } },
      });
      await expect(
        h.as(individual.actor).getVerificationEntry({ entryId })
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        h.as(individual.actor).verifyEntry({ entryId })
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(await h.as(verifier).verifyEntry({ entryId })).toEqual({
        ok: true,
        status: "foa_verified",
      });
      expect(await statusOf(h, entryId)).toBe("foa_verified");
    }
    await h.drain();
    expect(h.email.lastTo(individual.email)?.subject).toContain("FOA verified");
    expect(
      await h.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "entry.foa_verified"))
    ).toHaveLength(2);
  });
  it("sends back, requeues correction and preserves the decision history", async () => {
    const h = await createHarness();
    const individual = await individualEntryAtFoa(h);
    const verifier = await signedInVerifier(h);
    const { entryId } = individual;
    await expect(
      h
        .as(individual.actor)
        .sendBackEntry({ entryId, reason: { code: "wrong_work" } })
    ).rejects.toMatchObject({ code: "forbidden" });
    const decision = await h.as(verifier).sendBackEntry({
      entryId,
      reason: { code: "other", text: "Please correct the title" },
    });
    expect(decision).toEqual({
      ok: true,
      status: "sent_back",
      resubmissionDueAt: new Date(h.clock.now().getTime() + 7 * 86400000),
    });
    await h.drain();
    expect(h.email.lastTo(individual.email)?.text).toContain(
      "Please correct the title"
    );
    await expect(
      h.as(verifier).resubmitEntry({ entryId })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await h.as(individual.actor).resubmitEntry({
        entryId,
        title: "Correct title",
        description: "Correct description",
      })
    ).toEqual({ ok: true, status: "submitted_to_foa" });
    const queue = await h.as(verifier).listVerificationQueue({});
    expect(queue).toMatchObject({
      ok: true,
      items: [{ entryId, title: "Correct title", resubmitted: true }],
    });
    expect(await h.as(verifier).verifyEntry({ entryId })).toEqual({
      ok: true,
      status: "foa_verified",
    });
    expect(
      await h.db
        .select()
        .from(entryVerification)
        .where(eq(entryVerification.entryId, entryId))
    ).toHaveLength(2);
  });
  it("accepts an in-time new file and rejects corrections after the deadline", async () => {
    const h = await createHarness();
    const individual = await individualEntryAtFoa(h);
    const verifier = await signedInVerifier(h);
    const { entryId } = individual;
    await h.settings.set("entries.resubmissionDays", 2);
    await h
      .as(verifier)
      .sendBackEntry({ entryId, reason: { code: "wrong_work" } });
    await submittedImage(h, individual);
    expect(await statusOf(h, entryId)).toBe("sent_back");
    await h.drain();
    expect(await statusOf(h, entryId)).toBe("submitted_to_foa");
    await h
      .as(verifier)
      .sendBackEntry({ entryId, reason: { code: "wrong_work" } });
    h.clock.advance({ days: 2 });
    expect(await h.as(individual.actor).resubmitEntry({ entryId })).toEqual({
      ok: false,
      error: "resubmission_closed",
    });
    expect(await statusOf(h, entryId)).toBe("sent_back");
  });
  it("tells the school's coordinator, lets them resubmit, and verifies the corrected school entry", async () => {
    const h = await createHarness();
    const school = await schoolEntriesAtFoa(h);
    const verifier = await signedInVerifier(h);
    const entryId = school.entryIds[1]!;
    const [coordinator] = await h.db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, school.coordinator.userId));
    expect(
      await h.as(verifier).sendBackEntry({
        entryId,
        reason: {
          code: "missing_declaration",
          text: "Please add a declaration",
        },
      })
    ).toMatchObject({ ok: true, status: "sent_back" });
    await h.drain();
    expect(h.email.lastTo(coordinator!.email!)?.text).toContain(
      "Please add a declaration"
    );
    await submittedImage(h, school.forStudent(1));
    expect(await statusOf(h, entryId)).toBe("sent_back");
    await h.drain();
    expect(await statusOf(h, entryId)).toBe("submitted_to_foa");
    expect(await h.as(verifier).verifyEntry({ entryId })).toEqual({
      ok: true,
      status: "foa_verified",
    });
  });
  it("requeues a corrected typed essay immediately", async () => {
    const h = await createHarness();
    const participant = await confirmedAdult(h, { disciplines: ["essay"] });
    const app = h.as(participant.actor);
    const data = {
      registrationId: participant.registrationId,
      discipline: "essay",
      ...ENTRY_TEXT,
      essay: essayOf(30),
    };
    const submitted = await app.submitEssayText(data);
    expect(submitted).toMatchObject({ ok: true, status: "submitted" });
    await h.drain();
    h.clock.advance({ days: 81 });
    await h.drain();
    const verifier = await signedInVerifier(h);
    const queue = await h.as(verifier).listVerificationQueue({});
    if (!queue.ok || !queue.items[0]) throw new Error("Missing queued essay");
    const { entryId } = queue.items[0];
    await h
      .as(verifier)
      .sendBackEntry({ entryId, reason: { code: "wrong_work" } });
    expect(
      await app.submitEssayText({ ...data, essay: essayOf(31) })
    ).toMatchObject({ ok: true, status: "submitted_to_foa" });
    expect(await h.as(verifier).verifyEntry({ entryId })).toMatchObject({
      ok: true,
      status: "foa_verified",
    });
  });
});
