import { auditLog, judgeInvitation } from "../../db/schema";
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
    const stored = JSON.stringify(await h.db.select().from(judgeInvitation));
    expect(stored).not.toContain(judge.email);
    expect(stored).not.toContain(token);
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
    const logged = await h.db.select().from(auditLog);
    expect(logged.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "judging.judge_invited",
        "role.granted",
        "judging.invitation_accepted",
        "judging.conflicts_declared",
        "role.revoked",
        "judging.judge_removed",
      ])
    );
    expect(JSON.stringify(logged)).not.toContain(token);
  });
});

describe("invitation lifecycle and scope isolation", () => {
  it("withdraws superseded invites and enforces expiry, decline and round-specific permission", async () => {
    const h = await createHarness();
    const competition = await seedCompetition(h, { disciplines: ["drawing"] });
    const manager = h.as(await signedInWith(h, managerOf(competition.id)));
    const rub = await manager.createRubricDraft({
      competitionId: competition.id,
      discipline: "drawing",
    });
    if (!rub.ok) throw new Error(rub.error);
    await manager.publishRubric({ rubricId: rub.rubric.id });
    const a = await manager.createJudgingRound({
      competitionId: competition.id,
      name: "A",
    });
    const b = await manager.createJudgingRound({
      competitionId: competition.id,
      name: "B",
    });
    if (!a.ok || !b.ok) throw new Error("Round creation failed");
    const roundId = a.roundId;
    const judge = await h.seed.member({ email: "round-judge@example.test" });
    const invitee = h.as(await h.signIn(judge));
    const visitor = h.as(h.visitor());
    const send = async () => {
      const result = await manager.inviteJudge({ roundId, email: judge.email });
      if (!result.ok) throw new Error(result.error);
      await h.drain();
      const token = /\/judge\/invitations\/([\w-]{43})/.exec(
        h.email.lastTo(judge.email)?.text ?? ""
      )?.[1];
      if (!token) throw new Error("Invitation not delivered");
      return { ...result, token };
    };
    const first = await send();
    expect(
      await visitor.viewJudgeInvitation({ token: first.token })
    ).toMatchObject({ ok: true, status: "pending", signedIn: false });
    expect(await visitor.viewJudgeInvitation({ token: "bad" })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await visitor.acceptJudgeInvitation({ token: first.token })).toEqual(
      { ok: false, error: "sign_in_required" }
    );
    expect(
      await visitor.declineJudgeInvitation({ token: first.token })
    ).toEqual({ ok: false, error: "sign_in_required" });
    await expect(visitor.myJudgeRounds()).rejects.toMatchObject({
      code: "forbidden",
    });
    const second = await send();
    expect(await invitee.acceptJudgeInvitation({ token: first.token })).toEqual(
      { ok: false, error: "revoked" }
    );
    expect(
      await invitee.declineJudgeInvitation({ token: second.token })
    ).toEqual({ ok: true, roundId });
    expect(
      await invitee.acceptJudgeInvitation({ token: second.token })
    ).toEqual({ ok: false, error: "declined" });
    const third = await send();
    expect(
      await manager.revokeJudgeInvitation({
        roundId,
        invitationId: third.invitationId,
      })
    ).toMatchObject({ ok: true });
    expect(await invitee.acceptJudgeInvitation({ token: third.token })).toEqual(
      { ok: false, error: "revoked" }
    );
    const fourth = await send();
    h.clock.advance({ days: 14 });
    expect(
      await invitee.acceptJudgeInvitation({ token: fourth.token })
    ).toEqual({ ok: false, error: "expired" });
    // Refresh staff and invitee sessions after the clock advance.
    const renewed = h.as(await signedInWith(h, managerOf(competition.id)));
    const result = await renewed.inviteJudge({ roundId, email: judge.email });
    expect(result).toMatchObject({ ok: true });
    await h.drain();
    const token = /\/judge\/invitations\/([\w-]{43})/.exec(
      h.email.lastTo(judge.email)?.text ?? ""
    )?.[1];
    if (!token) throw new Error("Invitation not delivered");
    const signed = h.as(await h.signIn(judge));
    expect(await signed.acceptJudgeInvitation({ token })).toEqual({
      ok: true,
      roundId,
    });
    expect(await renewed.listRoundJudges({ roundId })).toMatchObject({
      ok: true,
      judges: [{ userId: judge.id, readiness: { ready: false } }],
    });
    await expect(
      signed.getJudgeOnboarding({ roundId: b.roundId })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      signed.declareConflicts({
        roundId: b.roundId,
        declaration: { none: true },
      })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await renewed.inviteJudge({ roundId, email: judge.email })).toEqual({
      ok: false,
      error: "already_judge",
    });
  });
});
