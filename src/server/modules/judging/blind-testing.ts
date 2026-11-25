// Harness-only helpers: the real #95 admission, onboarding and assignment use cases.
import { eq } from "drizzle-orm";
import type { Harness } from "@/test/harness";
import {
  entry,
  registration,
  participantProfile,
  institution,
} from "../../db/schema";
import { insertConsentDocumentVersion } from "../consent/insert-version";
import { schoolEntriesAtFoa, signedInVerifier } from "../verification/testing";
import { managerOf, signedInWith } from "./testing";

export async function scoringWorld(h: Harness) {
  const school = await schoolEntriesAtFoa(h);
  const manager = await signedInWith(h, managerOf(school.competition.id));
  const staff = h.as(manager);
  const verifier = h.as(await signedInVerifier(h));
  const entryId = school.entryIds[1]!;
  const otherEntryId = school.entryIds[2]!;
  for (const id of [entryId, otherEntryId]) {
    const verified = await verifier.verifyEntry({ entryId: id });
    if (!verified.ok) throw new Error(JSON.stringify(verified));
  }
  const made = await staff.createJudgingRound({
    competitionId: school.competition.id,
    name: "Blind final",
    judgesPhysical: false,
  });
  if (!made.ok) throw new Error(made.error);
  const roundId = made.roundId;
  const admitted = await staff.admitToPool({
    roundId,
    entryIds: [entryId, otherEntryId],
  });
  if (!admitted.ok || admitted.admitted !== 2)
    throw new Error(JSON.stringify(admitted));
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
  const scope = { type: "round", id: roundId } as const;
  const readyJudge = async (id: string) => {
    const user = await h.seed.member();
    await h.seed.grant(user, { role: "judge", scope });
    const actor = await h.signIn(user);
    const judge = h.as(actor);
    const terms = await judge.acceptJudgeTerms({
      roundId,
      conductDocumentId: conduct.id,
      confidentialityDocumentId: confidentiality.id,
    });
    if (!terms.ok) throw new Error(terms.error);
    const conflicts = await judge.declareConflicts({
      roundId,
      declaration: { none: true },
    });
    if (!conflicts.ok) throw new Error(conflicts.error);
    const assigned = await staff.assignEntries({
      roundId,
      judgeUserId: user.id,
      entryIds: [id],
    });
    if (!assigned.ok || assigned.assigned !== 1)
      throw new Error(JSON.stringify(assigned));
    return { actor, user };
  };
  const a = await readyJudge(entryId);
  const b = await readyJudge(otherEntryId);
  const newJudge = await signedInWith(h, { role: "judge", scope });
  const outsider = await signedInWith(h, {
    role: "judge",
    scope: { type: "global" },
  });
  const opened = await staff.openJudgingRound({ roundId });
  if (!opened.ok) throw new Error(opened.error);
  const [row] = await h.db
    .select({ code: entry.code })
    .from(entry)
    .where(eq(entry.id, entryId));
  const [other] = await h.db
    .select({ code: entry.code })
    .from(entry)
    .where(eq(entry.id, otherEntryId));
  return {
    school,
    roundId,
    entryId,
    otherEntryId,
    code: row!.code,
    otherCode: other!.code,
    judge: a.actor,
    judgeUser: a.user,
    otherJudge: b.actor,
    newJudge,
    outsider,
    manager,
  };
}

/** Distinctive identity and metadata values that must not enter a blind projection. */
export async function identifiableWork(
  h: Harness,
  w: Awaited<ReturnType<typeof scoringWorld>>
) {
  const [work] = await h.db.select().from(entry).where(eq(entry.id, w.entryId));
  const [reg] = await h.db
    .select()
    .from(registration)
    .where(eq(registration.id, work!.registrationId));
  const [profile] = await h.db
    .select()
    .from(participantProfile)
    .where(eq(participantProfile.id, work!.participantProfileId));
  const title = "Aarav’s private title";
  const description = "Private description sentinel";
  const statement = "Private statement sentinel";
  await h.db
    .update(entry)
    .set({ title, description, statement })
    .where(eq(entry.id, w.entryId));
  await h.db
    .update(participantProfile)
    .set({
      fullName: "Aarav Sharma",
      city: "Pune",
      schoolName: "St. Mary's School",
    })
    .where(eq(participantProfile.id, work!.participantProfileId));
  await h.db
    .update(institution)
    .set({ name: "St. Mary's School", city: "Pune" })
    .where(eq(institution.id, w.school.institutionId));
  return [
    "Aarav Sharma",
    "St. Mary's School",
    "Pune",
    "guardian-1@example.test",
    work!.participantProfileId,
    reg!.registrationNumber!,
    reg!.id,
    profile!.guardianEmailCiphertext!,
    profile!.guardianPhoneCiphertext!,
    title,
    description,
    statement,
  ];
}
