import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { schoolEntriesAtFoa, signedInVerifier } from "../verification/testing";
import { managerOf, signedInWith } from "./testing";
import { insertConsentDocumentVersion } from "../consent/insert-version";
import { conflictedEntryIds } from "./conflict-facts";

describe("FOA round pool and assignment", () => {
  it("admits verified digital entries only, refuses physical before readiness and refuses conflicts", async () => {
    const h = await createHarness();
    const world = await schoolEntriesAtFoa(h);
    const competitionId = world.competition.id;
    const manager = h.as(await signedInWith(h, managerOf(competitionId)));
    const verifier = h.as(await signedInVerifier(h));
    const entryIds = [world.entryIds[1]!, world.entryIds[2]!];
    for (const entryId of entryIds)
      expect(await verifier.verifyEntry({ entryId })).toMatchObject({
        ok: true,
      });
    const physical = await manager.createJudgingRound({
      competitionId,
      name: "Physical",
    });
    const digital = await manager.createJudgingRound({
      competitionId,
      name: "Digital",
      judgesPhysical: false,
    });
    if (!physical.ok || !digital.ok) throw new Error("round setup failed");
    const roundId = digital.roundId;
    expect(
      await manager.admitToPool({ roundId: physical.roundId, entryIds })
    ).toMatchObject({
      ok: true,
      admitted: 0,
      refused: entryIds.map((entryId) => ({
        entryId,
        reason: "not_physically_ready",
      })),
    });
    expect(
      await manager.admitToPool({
        roundId,
        entryIds: [...entryIds, world.entryIds[3]!],
      })
    ).toMatchObject({
      ok: true,
      admitted: 2,
      refused: [{ entryId: world.entryIds[3], reason: "not_foa_verified" }],
    });
    const judge = await h.seed.member();
    await h.seed.grant(judge, {
      role: "judge",
      scope: { type: "round", id: roundId },
    });
    const judgeActor = await h.signIn(judge);
    expect(
      await manager.assignEntries({ roundId, judgeUserId: judge.id, entryIds })
    ).toMatchObject({ ok: false, error: "judge_not_ready" });
    const body = {
      short: [["Sample"]],
      sections: [
        { id: "rules", title: "Rules", blocks: [{ p: ["Sample terms"] }] },
      ],
    };
    const conduct = await insertConsentDocumentVersion(
      h.db,
      { now: h.clock.now(), publishedByUserId: null },
      { purpose: "judge_conduct", title: null, body, legalRevisionId: null }
    );
    const confidentiality = await insertConsentDocumentVersion(
      h.db,
      { now: h.clock.now(), publishedByUserId: null },
      {
        purpose: "judge_confidentiality",
        title: null,
        body,
        legalRevisionId: null,
      }
    );
    const j = h.as(judgeActor);
    expect(
      await j.acceptJudgeTerms({
        roundId,
        conductDocumentId: conduct.id,
        confidentialityDocumentId: confidentiality.id,
      })
    ).toMatchObject({ ok: true });
    expect(
      await j.declareConflicts({
        roundId,
        declaration: {
          none: false,
          institutionIds: [world.ref.institutionId],
          statement: "My school",
        },
      })
    ).toMatchObject({ ok: true });
    expect(
      await manager.assignEntries({ roundId, judgeUserId: judge.id, entryIds })
    ).toMatchObject({
      ok: true,
      assigned: 0,
      refused: entryIds.map((entryId) => ({ entryId, reason: "conflict" })),
    });
    expect(
      await j.declareConflicts({ roundId, declaration: { none: true } })
    ).toMatchObject({ ok: true });
    expect(
      await manager.assignEntries({ roundId, judgeUserId: judge.id, entryIds })
    ).toMatchObject({ ok: true, assigned: 2 });
    expect(
      await manager.flagConflict({
        roundId,
        judgeUserId: judge.id,
        entryId: entryIds[0]!,
      })
    ).toMatchObject({ ok: true });
    expect(await conflictedEntryIds(h.db, roundId, judge.id)).toEqual(
      new Set([entryIds[0]])
    );
    expect(await manager.listAssignments({ roundId })).toMatchObject({
      ok: true,
      assignments: [{ entryId: entryIds[1] }],
    });
    expect(await manager.getRoundPool({ roundId })).toMatchObject({ ok: true });
    expect(await manager.listRoundConflicts({ roundId })).toMatchObject({
      ok: true,
    });
    expect(
      await manager.unassignEntry({
        roundId,
        judgeUserId: judge.id,
        entryId: entryIds[1]!,
      })
    ).toMatchObject({ ok: true });
    // A live institution role acquired after onboarding takes effect on the next assignment.
    await h.seed.grant(judge, {
      role: "institution_coordinator",
      scope: { type: "institution", id: world.ref.institutionId },
    });
    expect(
      await manager.assignEntries({
        roundId,
        judgeUserId: judge.id,
        entryIds: [entryIds[1]!],
      })
    ).toMatchObject({
      ok: true,
      assigned: 0,
      refused: [{ entryId: entryIds[1], reason: "conflict" }],
    });
    expect(await conflictedEntryIds(h.db, roundId, judge.id)).toEqual(
      new Set(entryIds)
    );
    expect(
      await manager.assignEntries({
        roundId,
        judgeUserId: judge.id,
        entryIds: [world.entryIds[3]!],
      })
    ).toMatchObject({
      ok: true,
      assigned: 0,
      refused: [{ entryId: world.entryIds[3], reason: "not_in_pool" }],
    });
    for (const call of [
      () => j.admitToPool({ roundId, entryIds }),
      () => j.getRoundPool({ roundId }),
      () => j.assignEntries({ roundId, judgeUserId: judge.id, entryIds }),
      () =>
        j.flagConflict({
          roundId,
          judgeUserId: judge.id,
          entryId: entryIds[0]!,
        }),
      () => j.listAssignments({ roundId }),
      () => j.listRoundConflicts({ roundId }),
      () =>
        j.unassignEntry({
          roundId,
          judgeUserId: judge.id,
          entryId: entryIds[0]!,
        }),
    ])
      await expect(call()).rejects.toMatchObject({ code: "forbidden" });
  });
});
