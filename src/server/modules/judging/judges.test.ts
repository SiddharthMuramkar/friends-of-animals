import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { grantsOf } from "../../access/grants";
import { insertConsentDocumentVersion } from "../consent/insert-version";
import { managerOf, seedCompetition, signedInWith } from "./testing";
import { loadJudgeReadiness } from "./judges";

describe("round judge invitation and onboarding", () => {
  it("requires the invited verified account and completion of both declarations", async () => {
    const h = await createHarness();
    const competition = await seedCompetition(h, { disciplines: ["drawing"] });
    const manager = await signedInWith(h, managerOf(competition.id));
    const as = h.as(manager);
    const rubric = await as.createRubricDraft({
      competitionId: competition.id,
      discipline: "drawing",
    });
    if (!rubric.ok) throw new Error(rubric.error);
    await as.publishRubric({ rubricId: rubric.rubric.id });
    const made = await as.createJudgingRound({
      competitionId: competition.id,
      name: "National",
    });
    if (!made.ok) throw new Error(made.error);
    const { roundId } = made;
    const judge = await h.seed.member({ email: "judge@example.test" });
    const judgeActor = await h.signIn(judge);
    const member = h.as(await signedInWith(h));
    const invited = await as.inviteJudge({ roundId, email: judge.email });
    if (!invited.ok) throw new Error(invited.error);
    await h.drain();
    const token = /\/judge\/invitations\/([\w-]{43})/.exec(
      h.email.lastTo(judge.email)?.text ?? ""
    )?.[1];
    if (!token) throw new Error("Invitation was not delivered");
    expect(await member.acceptJudgeInvitation({ token })).toMatchObject({
      ok: false,
      error: "email_mismatch",
    });
    const j = h.as(judgeActor);
    expect(await j.acceptJudgeInvitation({ token })).toMatchObject({
      ok: true,
      roundId,
    });
    expect(await grantsOf(h.db, judge.id)).toContainEqual({
      role: "judge",
      scope: { type: "round", id: roundId },
    });
    expect(await j.acceptJudgeInvitation({ token })).toMatchObject({
      ok: false,
      error: "already_accepted",
    });
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
    expect(await j.getJudgeOnboarding({ roundId })).toMatchObject({
      ok: true,
      readiness: {
        ready: false,
        missing: ["conduct", "confidentiality", "conflicts"],
      },
    });
    expect(
      await j.acceptJudgeTerms({
        roundId,
        conductDocumentId: conduct.id,
        confidentialityDocumentId: confidentiality.id,
      })
    ).toMatchObject({ ok: true });
    expect(
      await j.declareConflicts({ roundId, declaration: { none: true } })
    ).toMatchObject({ ok: true });
    expect(
      await loadJudgeReadiness(h.db, { roundId, judgeUserId: judge.id })
    ).toEqual({ ready: true });
    expect(await j.myJudgeRounds()).toMatchObject({
      ok: true,
      rounds: [{ round: { id: roundId }, readiness: { ready: true } }],
    });
    for (const call of [
      () => member.inviteJudge({ roundId, email: judge.email }),
      () => member.listRoundJudges({ roundId }),
      () =>
        member.revokeJudgeInvitation({
          roundId,
          invitationId: invited.invitationId,
        }),
      () => member.removeJudge({ roundId, userId: judge.id }),
      () => member.getJudgeOnboarding({ roundId }),
      () =>
        member.acceptJudgeTerms({
          roundId,
          conductDocumentId: conduct.id,
          confidentialityDocumentId: confidentiality.id,
        }),
      () => member.declareConflicts({ roundId, declaration: { none: true } }),
    ])
      await expect(call()).rejects.toMatchObject({ code: "forbidden" });
    expect(await as.removeJudge({ roundId, userId: judge.id })).toMatchObject({
      ok: true,
    });
    expect(
      await loadJudgeReadiness(h.db, { roundId, judgeUserId: judge.id })
    ).toMatchObject({ ready: false });
    await expect(j.getJudgeOnboarding({ roundId })).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
