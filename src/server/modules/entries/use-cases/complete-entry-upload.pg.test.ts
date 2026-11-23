import { and, eq, gt } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { entryUploadGrant, fileAsset } from "@/server/db/schema";
import {
  adultForm,
  openToIndividuals,
} from "@/server/modules/participants/testing";
import { readMediaFixture } from "@/test/media-fixtures";
import { createPgWorld, type PgWorld } from "@/test/pg";

import { PHOTO, putEntryImage } from "../testing";

let world: PgWorld;

beforeAll(() => {
  world = createPgWorld();
});

afterAll(async () => {
  await world.close();
});

async function confirmedRegistration() {
  const letters = Array.from({ length: 6 }, () =>
    String.fromCharCode(65 + randomInt(26))
  ).join("");
  const code = `${letters}27`;
  const competition = await openToIndividuals(world, {
    code,
    name: `Entry race ${code}`,
    fee: 0n,
  });
  const account = await world.seed.member({ email: world.uniqueEmail() });
  const actor = await world.signedIn(account);
  const app = world.as(actor);
  const registered = await app.registerAsIndividual(adultForm(competition));
  if (!registered.ok) throw new Error(registered.error);
  const paid = await app.payForMyRegistration({
    registrationId: registered.registrationId,
  });
  if (!paid.ok) throw new Error(paid.error);
  return { actor, registrationId: registered.registrationId, app };
}

it("issues one open grant for simultaneous requests on separate connections", async () => {
  const { actor, app, registrationId } = await confirmedRegistration();
  const input = {
    registrationId,
    discipline: "drawing",
    file: { name: "work.jpg", type: "image/jpeg", size: PHOTO.length },
  };
  const blocker = await world.sql.reserve();
  try {
    await blocker`begin`;
    await blocker`select id from "user" where id = ${actor.userId} for no key update`;
    const started = Promise.all([
      app.startEntryUpload(input),
      world.as(actor).startEntryUpload(input),
    ]);
    try {
      await world.waitForLockWaiters(2);
    } finally {
      await blocker`rollback`;
      await started;
    }
    const results = await started;
    expect(results).toHaveLength(2);
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ok: true }),
        { ok: false, error: "upload_limit" },
      ])
    );
    const granted = results.find((result) => result.ok);
    expect(
      await world.db
        .select({ fileId: entryUploadGrant.fileAssetId })
        .from(entryUploadGrant)
        .innerJoin(fileAsset, eq(fileAsset.id, entryUploadGrant.fileAssetId))
        .where(
          and(
            eq(entryUploadGrant.registrationId, registrationId),
            eq(entryUploadGrant.retired, false),
            eq(fileAsset.status, "pending_upload"),
            gt(entryUploadGrant.expiresAt, world.clock.now())
          )
        )
    ).toEqual([{ fileId: granted?.fileId }]);
  } finally {
    blocker.release();
  }
});

describe("dispatching an accepted upload", () => {
  it.each([
    { fixture: "gpsJpeg", status: "submitted" },
    { fixture: "corruptJpeg", status: "failed" },
  ] as const)(
    "commits the attachment before a media result of $status can arrive",
    async ({ fixture, status }) => {
      const participant = await confirmedRegistration();
      const request = await putEntryImage(world, participant, {
        bytes: readMediaFixture(fixture),
      });
      const previousJobs = world.media.processed.length;

      // A separate connection lets the worker read attachments while the
      // confirmation is waiting to insert its own.
      const blocker = await world.sql.reserve();
      try {
        await blocker`begin`;
        await blocker`lock table entry_file in share mode`;
        const completed = participant.app.completeEntryUpload(request);
        try {
          const first = await Promise.race([
            world.waitForLockWaiters(1).then(() => "waiting"),
            completed.then(() => "finished"),
          ]);
          expect(first).toBe("waiting");
          await world.drain();
          expect(world.media.processed).toHaveLength(previousJobs);
        } finally {
          await blocker`rollback`;
          await completed;
        }
        expect(await completed).toMatchObject({
          ok: true,
          status: "processing",
        });
      } finally {
        blocker.release();
      }

      await world.drain();
      expect(world.media.processed).toHaveLength(previousJobs + 1);
      expect(await participant.app.listMyEntries()).toMatchObject([{ status }]);
    }
  );
});
