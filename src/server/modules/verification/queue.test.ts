import { describe, expect, it } from "vitest";

import { schoolRound } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { globalManager, signedInWith } from "@/server/modules/judging/testing";
import {
  confirmedAdult,
  submittedImage,
} from "@/server/modules/entries/testing";
import { schoolInJudging } from "@/server/modules/school-round/testing";
import { EICAR_TEST_BYTES } from "@/test/eicar";
import { createHarness } from "@/test/harness";

import {
  closeSubmissions,
  entryIdOf,
  historyOf,
  individualEntryAtFoa,
  schoolEntriesAtFoa,
  signedInVerifier,
  statusOf,
  submittedIndividualEntry,
} from "./testing";

// #92: entries reach FOA from both routes. An individual entry skips the
// school round: once submissions close it goes on to FOA by itself (an
// entry still being checked then goes as soon as it is submitted). A
// school's shortlisted entries arrive when its round is finalised (#89).
// The verifier's queue lists every entry waiting for verification, oldest
// arrival first.

describe("individual entries reaching FOA", () => {
  it("go on to FOA when submissions close, with no school round", async () => {
    const h = await createHarness();
    const submitted = await submittedIndividualEntry(h);

    expect(await statusOf(h, submitted.entryId)).toBe("submitted");
    await closeSubmissions(h);

    expect(await statusOf(h, submitted.entryId)).toBe("submitted_to_foa");
    expect(await historyOf(h, submitted.entryId)).toEqual([
      "processing",
      "submitted",
      "submitted_to_foa",
    ]);
    expect(await h.db.select().from(schoolRound)).toEqual([]);
  });

  it("stay with the participant while submissions are open", async () => {
    const h = await createHarness();
    const submitted = await submittedIndividualEntry(h);

    h.clock.advance({ days: 79 });
    await h.drain();

    expect(await statusOf(h, submitted.entryId)).toBe("submitted");
  });

  it("go on as soon as a file still being checked at the deadline passes", async () => {
    const h = await createHarness();
    const submitted = await submittedIndividualEntry(h);
    const late = await confirmedAdult(h, {
      competition: submitted.competition,
    });
    const code = await submittedImage(h, late);
    const lateId = await entryIdOf(h, code);

    // The late upload's scan has no verdict yet when submissions close.
    h.scanner.failNext(1);
    await closeSubmissions(h);
    expect(await statusOf(h, submitted.entryId)).toBe("submitted_to_foa");
    expect(await statusOf(h, lateId)).toBe("processing");

    h.clock.advance({ minutes: 5 });
    await h.drain();
    expect(await statusOf(h, lateId)).toBe("submitted_to_foa");
  });

  it("never forwards an entry whose file was refused", async () => {
    const h = await createHarness();
    const participant = await confirmedAdult(h);
    const code = await submittedImage(h, participant, {
      bytes: EICAR_TEST_BYTES,
    });
    await h.drain();
    await closeSubmissions(h);

    expect(await statusOf(h, await entryIdOf(h, code))).toBe("rejected");
  });

  it("leaves a school's submitted entries to its school round", async () => {
    const h = await createHarness();
    const world = await schoolInJudging(h, { students: 1, submit: [1] });

    expect(await statusOf(h, world.entryIds[1]!)).toBe("submitted");
  });

  it("can only be forwarded by the platform", async () => {
    const h = await createHarness();
    const submitted = await submittedIndividualEntry(h);
    const verifier = await signedInVerifier(h);

    await expect(
      h.as(verifier).forwardIndividualEntries({
        competitionId: submitted.competition.id,
      })
    ).rejects.toThrow(DomainError);
    await expect(
      h.as(submitted.actor).forwardIndividualEntries({
        competitionId: submitted.competition.id,
      })
    ).rejects.toThrow(DomainError);
  });
});

describe("listVerificationQueue", () => {
  it("lists entries waiting from both routes, oldest arrival first", async () => {
    const h = await createHarness();
    const school = await schoolEntriesAtFoa(h);
    const verifier = await signedInVerifier(h);

    const schoolQueue = await h.as(verifier).listVerificationQueue({});
    expect(schoolQueue.ok && schoolQueue.items.map((i) => i.entryId)).toEqual(
      expect.arrayContaining([school.entryIds[1], school.entryIds[2]])
    );

    h.clock.advance({ days: 1 });
    const individual = await individualEntryAtFoa(h);
    const queue = await h.as(verifier).listVerificationQueue({});
    if (!queue.ok) throw new Error(JSON.stringify(queue));

    expect(queue.items).toHaveLength(3);
    expect(queue.items.at(-1)).toMatchObject({
      entryId: individual.entryId,
      code: individual.code,
      route: "individual",
      discipline: "photography",
      competition: { id: individual.competition.id },
      resubmitted: false,
    });
    expect(queue.items[0]).toMatchObject({
      route: "school",
      institutionName: expect.any(String),
    });
    // Not shortlisted, so never at FOA.
    expect(queue.items.map((item) => item.entryId)).not.toContain(
      school.entryIds[3]
    );
    const arrivals = queue.items.map((item) => item.arrivedAt.getTime());
    expect(arrivals).toEqual([...arrivals].sort((a, b) => a - b));
  });

  it("filters by route and by competition", async () => {
    const h = await createHarness();
    const school = await schoolEntriesAtFoa(h);
    const individual = await individualEntryAtFoa(h);
    const verifier = await signedInVerifier(h);

    const individuals = await h
      .as(verifier)
      .listVerificationQueue({ route: "individual" });
    expect(individuals.ok && individuals.items.map((i) => i.entryId)).toEqual([
      individual.entryId,
    ]);
    const ofSchool = await h
      .as(verifier)
      .listVerificationQueue({ competitionId: school.competition.id });
    expect(ofSchool.ok && ofSchool.items.map((i) => i.route)).toEqual([
      "school",
      "school",
    ]);
  });

  it("is for FOA verifiers with their second factor only", async () => {
    const h = await createHarness();
    const individual = await submittedIndividualEntry(h);
    const manager = await signedInWith(h, globalManager);
    const unverified = await h.seed.member();
    await h.seed.grant(unverified, {
      role: "foa_verifier",
      scope: { type: "global" },
    });
    const withoutFactor = await h.signIn(unverified, undefined, {
      secondFactor: false,
    });

    for (const actor of [individual.actor, manager]) {
      await expect(h.as(actor).listVerificationQueue({})).rejects.toMatchObject(
        { code: "forbidden" }
      );
    }
    await expect(
      h.as(withoutFactor).listVerificationQueue({})
    ).rejects.toMatchObject({
      code: expect.stringMatching(/second_factor_required|enrolment_required/),
    });
    await expect(h.as(h.visitor()).listVerificationQueue({})).rejects.toThrow(
      DomainError
    );
  });
});
