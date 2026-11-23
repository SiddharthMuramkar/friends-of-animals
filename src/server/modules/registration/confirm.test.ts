import { inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { registration } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { confirmRegistrations } from "./confirm";
import { AANYA, registeredSchool } from "./testing";

/** Each draw is the next row of `rows` (the last one repeats). */
function draws(...rows: number[][]) {
  let next = 0;
  return (length: number) =>
    Uint8Array.from(rows[Math.min(next++, rows.length - 1)]!.slice(0, length));
}

async function enrolled(h: Harness, count: number) {
  const school = await registeredSchool(h, {
    competition: { code: "PAWS27", name: "Paws on the Pavement" },
  });
  const ids: string[] = [];
  for (let n = 1; n <= count; n++) {
    const result = await h.as(school.coordinator.actor).enrolStudent({
      institutionId: school.institutionId,
      reference: school.reference,
      student: {
        ...AANYA,
        fullName: `Student ${String.fromCharCode(64 + n)} Rao`,
        guardianEmail: `guardian-${n}@example.test`,
      },
    });
    if (!result.ok) throw new Error(`Could not enrol: ${result.error}`);
    ids.push(result.registrationId);
  }
  return ids.toSorted();
}

describe("confirmRegistrations", () => {
  it("draws another number when the one drawn is taken, keeping the confirmations made before it", async () => {
    const h = await createHarness();
    const ids = await enrolled(h, 2);
    const worker: Actor = { kind: "system", process: "worker" };

    // The second registration first draws the number the first one got.
    const result = await h.db.transaction((tx) =>
      confirmRegistrations(
        tx,
        { clock: h.clock, actor: worker, cipher: h.deps.cipher },
        {
          registrationIds: ids,
          competitionCode: "PAWS27",
          batchId: null,
          actorRole: null,
          random: draws(
            [1, 1, 1, 1, 1, 1],
            [1, 1, 1, 1, 1, 1],
            [2, 2, 2, 2, 2, 2]
          ),
        }
      )
    );

    expect(result).toEqual({
      confirmed: [
        { registrationId: ids[0], registrationNumber: "PAWS27-R-111111" },
        { registrationId: ids[1], registrationNumber: "PAWS27-R-222222" },
      ],
      refused: [],
    });
    expect(
      await h.db
        .select({
          id: registration.id,
          status: registration.status,
          registrationNumber: registration.registrationNumber,
        })
        .from(registration)
        .where(inArray(registration.id, ids))
        .orderBy(registration.id)
    ).toEqual([
      {
        id: ids[0],
        status: "confirmed",
        registrationNumber: "PAWS27-R-111111",
      },
      {
        id: ids[1],
        status: "confirmed",
        registrationNumber: "PAWS27-R-222222",
      },
    ]);
  });
});
