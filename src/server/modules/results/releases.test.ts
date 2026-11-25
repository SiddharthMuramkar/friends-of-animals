import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createHarness, type Harness } from "@/test/harness";
import {
  auditLog,
  outbox,
  resultAward,
  artworkResultsWindow,
} from "../../db/schema";
import { scoringWorld } from "../judging/blind-testing";
import { managerOf, signedInWith } from "../judging/testing";
import { collectSubjectData } from "../privacy/requests/subject-data/collect";
import { entry } from "../../db/schema";
import { publishedResults } from "./read-published";

const worker = { kind: "system", process: "worker" } as const;
async function lockedWorld(h: Harness) {
  const w = await scoringWorld(h);
  const comp = w.school.competition;
  for (const [actor, entryCode, score] of [
    [w.judge, w.code, 9],
    [w.otherJudge, w.otherCode, 6],
  ] as const) {
    const detail = await h
      .as(actor)
      .getBlindEntry({ roundId: w.roundId, entryCode });
    if (!detail.ok) throw Error(detail.error);
    expect(
      await h.as(actor).saveScoreSheet({
        roundId: w.roundId,
        entryCode,
        baseVersion: detail.sheet.version,
        scores: Object.fromEntries(detail.criteria.map((c) => [c.id, score])),
      })
    ).toMatchObject({ ok: true, progress: "complete" });
  }
  // Let the actual deadline job move the competition to FOA judging.
  h.clock.advance({ days: 20 });
  await h.drain();
  const manager = await signedInWith(h, managerOf(comp.id));
  const api = h.as(manager);
  const prepare = {
    competitionId: comp.id,
    sourceRoundId: w.roundId,
    publishAt: new Date(h.clock.now().getTime() + 20 * 60_000).toISOString(),
    deliveryNote: "The school will give the winner a trophy.",
  };
  expect(await api.prepareResultsRelease(prepare)).toMatchObject({
    ok: false,
    error: "final_round_required",
  });
  expect(await api.lockJudgingRound({ roundId: w.roundId })).toMatchObject({
    ok: true,
    rankedCount: 2,
  });
  return { w, manager, api, prepare, comp };
}
describe("results publication", () => {
  it("freezes the selected locked round, requires another stepped-up staff member and publishes once at the scheduled instant", async () => {
    const h = await createHarness();
    const { w, manager, api, prepare, comp } = await lockedWorld(h);
    const { competitionId } = prepare;
    const visitor = h.as(h.visitor());
    const denied = h.as(await h.signIn(await h.seed.member()));
    await expect(
      denied.getResultsRelease({ competitionId })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(denied.prepareResultsRelease(prepare)).rejects.toMatchObject({
      code: "forbidden",
    });
    const wrong = h.as(
      await signedInWith(h, managerOf("01938a00-0000-7000-8000-000000000001"))
    );
    await expect(wrong.prepareResultsRelease(prepare)).rejects.toMatchObject({
      code: "forbidden",
    });
    const continuation = await api.createJudgingRound({
      competitionId,
      name: "Continuation",
      entrySource: "round_finalists",
      sourceRoundId: w.roundId,
      judgesPhysical: false,
    });
    if (!continuation.ok) throw Error(continuation.error);
    expect(await api.prepareResultsRelease(prepare)).toMatchObject({
      ok: false,
      error: "final_round_required",
    });
    expect(
      await api.cancelJudgingRound({
        roundId: continuation.roundId,
        reason: "No longer proceeding to this round.",
      })
    ).toMatchObject({ ok: true });
    const made = await api.prepareResultsRelease(prepare);
    if (!made.ok) throw Error(made.error);
    const input = { competitionId, releaseId: made.releaseId };
    expect(await api.getResultsRelease({ competitionId })).toMatchObject({
      ok: true,
      release: { status: "pending_approval" },
      awards: [
        { awardBand: "first", entryCode: w.code },
        { awardBand: "second", entryCode: w.otherCode },
      ],
    });
    expect(await visitor.getPublicResults({ slug: comp.slug })).toBeNull();
    expect(await publishedResults(h.db, competitionId)).toBeNull();
    const [subject] = await h.db
      .select({ profileId: entry.participantProfileId })
      .from(entry)
      .where(eq(entry.id, w.entryId));
    const [other] = await h.db
      .select({ profileId: entry.participantProfileId })
      .from(entry)
      .where(eq(entry.id, w.otherEntryId));
    const subjectExport = () =>
      collectSubjectData(h.deps, {
        subject: { kind: "participant_profile", id: subject!.profileId },
        scope: { userIds: [], profileIds: [subject!.profileId] },
        reference: "TEST-RESULTS",
        generatedAt: h.clock.now(),
      });
    const draftExport = await subjectExport();
    expect(draftExport.document.sections.result_award ?? []).toEqual([]);
    expect(draftExport.document.sections.entry).toEqual([
      expect.objectContaining({ id: w.entryId }),
    ]);
    expect(draftExport.files).toHaveLength(1);

    expect(await h.as(worker).publishResultsRelease(input)).toMatchObject({
      ok: true,
      outcome: "ignored",
    });
    await expect(api.publishResultsRelease(input)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await api.approveResultsRelease(input)).toMatchObject({
      ok: false,
      error: "second_staff_required",
    });
    await expect(denied.approveResultsRelease(input)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(denied.rejectResultsRelease(input)).rejects.toMatchObject({
      code: "forbidden",
    });
    const approver = await h.seed.member();
    await h.seed.grant(approver, managerOf(competitionId));
    await h.seed.authenticator(approver);
    const notStepped = h.as(
      await h.signIn(approver, {}, { secondFactor: false })
    );
    await expect(notStepped.approveResultsRelease(input)).rejects.toMatchObject(
      { code: "step_up_required" }
    );
    const reviewerActor = await h.signIn(approver);
    const reviewer = h.as(reviewerActor);
    h.clock.advance({ minutes: 11 });
    await expect(reviewer.approveResultsRelease(input)).rejects.toMatchObject({
      code: "step_up_required",
    });
    await h.passSecondFactor(reviewerActor);
    expect(await reviewer.approveResultsRelease(input)).toMatchObject({
      ok: true,
      status: "approved",
    });
    expect(await reviewer.approveResultsRelease(input)).toMatchObject({
      ok: false,
      error: "release_not_reviewable",
    });
    // Later private recognition editing must not change the release already reviewed.
    expect(
      await api.tagRoundOutcomes({
        roundId: w.roundId,
        tags: [
          {
            entryId: w.entryId,
            outcome: "special_mention",
            awardPosition: null,
            suitableForAuction: false,
          },
        ],
      })
    ).toMatchObject({ ok: true });
    await expect(
      h.db
        .update(resultAward)
        .set({ prize: "changed" })
        .where(eq(resultAward.releaseId, made.releaseId))
    ).rejects.toThrow();
    h.clock.set(new Date(new Date(prepare.publishAt).getTime() - 1));
    await h.drain();
    expect(await h.as(worker).publishResultsRelease(input)).toMatchObject({
      ok: true,
      outcome: "early",
    });
    expect(await visitor.getPublicResults({ slug: comp.slug })).toBeNull();
    expect(
      (await subjectExport()).document.sections.result_award ?? []
    ).toEqual([]);
    expect(
      h.email.sent.filter((m) => m.subject.includes("Recognition at"))
    ).toHaveLength(0);
    h.clock.advance(1);
    await h.drain();
    const released = await publishedResults(h.db, competitionId);
    expect(released).toMatchObject({
      releaseId: made.releaseId,
      publishedAt: new Date(prepare.publishAt),
      lines: [
        { entryId: w.entryId, outcome: "winner", awardBand: "first" },
        { entryId: w.otherEntryId, outcome: "runner_up", awardBand: "second" },
      ],
    });
    const publishedExport = await subjectExport();
    expect(publishedExport.document.sections.result_award).toEqual([
      expect.objectContaining({
        entry_id: w.entryId,
        outcome: "winner",
        award_band: "first",
      }),
    ]);
    expect(
      publishedExport.document.sections.result_award![0]
    ).not.toHaveProperty("suitable_for_auction");
    const exported = JSON.stringify(publishedExport.document);
    expect(exported).not.toContain(w.otherEntryId);
    expect(exported).not.toContain(other!.profileId);
    expect(publishedExport.files).toEqual(
      expect.arrayContaining(draftExport.files)
    );
    expect(publishedExport.document.sections.certificate).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "participation" }),
        expect.objectContaining({ type: "winner" }),
      ])
    );
    expect(publishedExport.files.length).toBe(
      draftExport.files.length +
        publishedExport.document.files.filter(
          (f) => f.purpose === "certificate_pdf"
        ).length
    );
    expect(await visitor.getPublicResults({ slug: comp.slug })).toMatchObject({
      awards: [],
    });
    const awards = h.email.sent.filter((m) =>
      m.subject.includes("Recognition at")
    );
    expect(awards).toHaveLength(2);
    expect(awards.map((m) => m.to)).toEqual(
      expect.arrayContaining([
        "guardian-1@example.test",
        "guardian-2@example.test",
      ])
    );
    expect(awards[0]?.text).toContain(prepare.deliveryNote);
    expect(await h.as(worker).publishResultsRelease(input)).toMatchObject({
      ok: true,
      outcome: "ignored",
    });
    await h.drain();
    expect(
      h.email.sent.filter((m) => m.subject.includes("Recognition at"))
    ).toHaveLength(2);
    expect(
      await h.db
        .select()
        .from(artworkResultsWindow)
        .where(eq(artworkResultsWindow.competitionId, competitionId))
    ).toMatchObject([
      {
        releaseId: made.releaseId,
        resultsPublishedAt: new Date(prepare.publishAt),
      },
    ]);
    const publicationDeliveries = await h.db
      .select()
      .from(outbox)
      .where(
        and(
          eq(outbox.eventType, "results.published"),
          eq(outbox.aggregateId, competitionId)
        )
      );
    expect(new Set(publicationDeliveries.map((d) => d.eventId)).size).toBe(1);
    expect(publicationDeliveries.map((d) => d.handler)).toEqual(
      expect.arrayContaining([
        "artwork.open_results_window",
        "certificates.issue",
      ])
    );
    for (const delivery of publicationDeliveries)
      expect(delivery.payload).toMatchObject({
        competitionId,
        releaseId: made.releaseId,
        publishedAt: prepare.publishAt,
      });
    expect(await api.listCertificates({ competitionId })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "participation",
          renderStatus: "rendered",
        }),
        expect.objectContaining({
          type: "school_merit",
          renderStatus: "rendered",
        }),
        expect.objectContaining({ type: "winner", renderStatus: "rendered" }),
        expect.objectContaining({
          type: "runner_up",
          renderStatus: "rendered",
        }),
      ])
    );
    expect(
      await h.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.entityId, made.releaseId))
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "results.prepared" }),
        expect.objectContaining({ action: "results.approved" }),
        expect.objectContaining({ action: "results.published" }),
      ])
    );
    expect(
      await h.as(manager).getResultsRelease({ competitionId })
    ).toMatchObject({ ok: true, release: { status: "published" } });
    expect(
      await api.createJudgingRound({
        competitionId,
        name: "Not after publication",
        judgesPhysical: false,
      })
    ).toMatchObject({ ok: false, error: "results_published" });
    expect(
      await api.tagRoundOutcomes({
        roundId: w.roundId,
        tags: [
          {
            entryId: w.entryId,
            outcome: "finalist",
            awardPosition: null,
            suitableForAuction: false,
          },
        ],
      })
    ).toMatchObject({ ok: false, error: "results_published" });
    const admin = h.as(
      await signedInWith(h, { role: "super_admin", scope: { type: "global" } })
    );
    expect(
      await admin.cancelCompetition({
        competitionId,
        reason: "Cannot cancel now.",
      })
    ).toMatchObject({ ok: false, error: "results_published" });
  });
  it("allows an independent rejection, and never publishes after cancellation", async () => {
    const h = await createHarness();
    const { api, prepare, comp } = await lockedWorld(h);
    const competitionId = prepare.competitionId;
    const reviewer = h.as(await signedInWith(h, managerOf(competitionId)));
    const a = await api.prepareResultsRelease(prepare);
    if (!a.ok) throw Error(a.error);
    expect(
      await reviewer.rejectResultsRelease({
        competitionId,
        releaseId: a.releaseId,
      })
    ).toMatchObject({ ok: true, status: "rejected" });
    const b = await api.prepareResultsRelease(prepare);
    if (!b.ok) throw Error(b.error);
    expect(
      await reviewer.approveResultsRelease({
        competitionId,
        releaseId: b.releaseId,
      })
    ).toMatchObject({ ok: true });
    const admin = h.as(
      await signedInWith(h, { role: "super_admin", scope: { type: "global" } })
    );
    expect(
      await admin.cancelCompetition({
        competitionId,
        reason: "Cancelled before publication.",
      })
    ).toMatchObject({ ok: true });
    h.clock.advance({ minutes: 21 });
    await h.drain();
    expect(
      await h.as(h.visitor()).getPublicResults({ slug: comp.slug })
    ).toBeNull();
    expect(await publishedResults(h.db, competitionId)).toBeNull();
    expect(await api.getResultsRelease({ competitionId })).toMatchObject({
      ok: true,
      release: null,
    });
  });
});
