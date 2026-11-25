import { expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { PDF_IDENTITY_MARKER } from "@/test/pdf-fixtures";
import {
  confirmedAdult,
  ESSAY_PDF_UPLOAD,
  submittedImage,
} from "../../entries/testing";
import {
  closeSubmissions,
  entryIdOf,
  signedInVerifier,
} from "../../verification/testing";
import { insertConsentDocumentVersion } from "../../consent/insert-version";
import { managerOf, signedInWith } from "../testing";

it("shows a real uploaded PDF essay to a ready assigned judge only from its metadata-free derived copy", async () => {
  const h = await createHarness();
  const owner = await confirmedAdult(h, { disciplines: ["essay"] });
  const manager = h.as(await signedInWith(h, managerOf(owner.competition.id)));
  const rubric = await manager.createRubricDraft({
    competitionId: owner.competition.id,
    discipline: "essay",
  });
  if (!rubric.ok) throw new Error(rubric.error);
  expect(
    await manager.publishRubric({ rubricId: rubric.rubric.id })
  ).toMatchObject({ ok: true });
  const code = await submittedImage(h, owner, ESSAY_PDF_UPLOAD);
  await h.drain();
  expect(h.media.pdfs).toHaveLength(1);
  await closeSubmissions(h);
  const entryId = await entryIdOf(h, code);
  expect(
    await h.as(await signedInVerifier(h)).verifyEntry({ entryId })
  ).toMatchObject({ ok: true });
  const made = await manager.createJudgingRound({
    competitionId: owner.competition.id,
    name: "Essay round",
    judgesPhysical: false,
  });
  if (!made.ok) throw new Error(made.error);
  const roundId = made.roundId;
  expect(
    await manager.admitToPool({ roundId, entryIds: [entryId] })
  ).toMatchObject({ ok: true, admitted: 1 });
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
  const judge = await h.seed.member();
  await h.seed.grant(judge, {
    role: "judge",
    scope: { type: "round", id: roundId },
  });
  const actor = h.as(await h.signIn(judge));
  expect(
    await actor.acceptJudgeTerms({
      roundId,
      conductDocumentId: conduct.id,
      confidentialityDocumentId: confidentiality.id,
    })
  ).toMatchObject({ ok: true });
  expect(
    await actor.declareConflicts({ roundId, declaration: { none: true } })
  ).toMatchObject({ ok: true });
  expect(
    await manager.assignEntries({
      roundId,
      judgeUserId: judge.id,
      entryIds: [entryId],
    })
  ).toMatchObject({ ok: true, assigned: 1 });
  expect(await manager.openJudgingRound({ roundId })).toMatchObject({
    ok: true,
  });
  const input = { roundId, entryCode: code };
  const detail = await actor.getBlindEntry(input);
  if (!detail.ok) throw new Error(detail.error);
  const [media] = detail.view.media;
  if (media?.kind !== "document") throw new Error("No cleaned PDF");
  expect(media.url).toContain("/pdf_clean.pdf");
  expect(media.url).not.toContain("my-essay.pdf");
  const fetched = await h.storage.get(media.url);
  expect(fetched).toMatchObject({
    ok: true,
    contentType: "application/pdf",
    contentDisposition: 'inline; filename="work-1.pdf"',
  });
  if (!fetched.ok) throw new Error(fetched.error);
  expect(Buffer.from(fetched.bytes).toString()).not.toContain(
    PDF_IDENTITY_MARKER
  );
  expect(fetched.bytes).not.toEqual(ESSAY_PDF_UPLOAD.bytes);
  h.clock.advance({ seconds: 301 });
  expect(await h.storage.get(media.url)).toEqual({
    ok: false,
    error: "expired",
  });
  expect(await h.as(owner.actor).getBlindEntry(input)).toEqual({
    ok: false,
    error: "entry_not_found",
  });
});
