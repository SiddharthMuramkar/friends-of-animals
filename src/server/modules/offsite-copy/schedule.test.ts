import { describe, expect, it } from "vitest";

import type { CopyBucket } from "@/server/ports/copy-bucket";
import type { S3BucketConfig } from "@/server/ports/copy-bucket-s3";
import { streamOf } from "@/server/ports/copy-bucket.contract";
import { SCHEDULES } from "@/server/outbox/schedules";
import { FakeCopyBucket } from "@/test/fakes/copy-bucket";
import { createHarness } from "@/test/harness";

import {
  OffsiteCopyIncompleteError,
  OffsiteCopyNotConfiguredError,
} from "./errors";
import { runScheduledOffsiteCopy } from "./schedule";

const PRODUCTION = {
  APP_ENV: "production",
  OFFSITE_SOURCE_BUCKETS: "foa-files-prod",
  R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  OFFSITE_R2_ACCESS_KEY_ID: "r2-read-key",
  OFFSITE_R2_SECRET_ACCESS_KEY: "r2-read-secret",
  B2_S3_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com",
  B2_REGION: "eu-central-003",
  B2_BUCKET: "foa-offsite",
  B2_KEY_ID: "b2-key-id",
  B2_APPLICATION_KEY: "b2-application-key",
};

const noBuckets = (): { source: CopyBucket; target: CopyBucket } => {
  throw new Error("no bucket should be opened");
};

describe("the offsite_copy schedule", () => {
  it("runs at 01:30 IST, before the database backup, retrying three times", () => {
    // pg-boss's own option names, so the worker passes them on unchanged.
    expect(SCHEDULES).toContainEqual({
      name: "offsite_copy",
      cron: "30 1 * * *",
      tz: "Asia/Kolkata",
      retryLimit: 3,
      retryDelay: 900,
      retryBackoff: true,
      expireInSeconds: 3 * 60 * 60,
      run: expect.any(Function),
    });
  });
});

describe("runScheduledOffsiteCopy", () => {
  it("does nothing outside production", async () => {
    const h = await createHarness();

    await runScheduledOffsiteCopy(
      h.deps,
      { finalAttempt: true },
      { env: { APP_ENV: "staging" }, connect: noBuckets }
    );

    expect(h.errors.reported).toEqual([]);
  });

  it("fails in production without its settings, and reports it on the final attempt", async () => {
    const h = await createHarness();
    const env = { APP_ENV: "production", B2_KEY_ID: "b2-key-id" };

    await expect(
      runScheduledOffsiteCopy(
        h.deps,
        { finalAttempt: false },
        { env, connect: noBuckets }
      )
    ).rejects.toThrow(OffsiteCopyNotConfiguredError);
    expect(h.errors.reported).toEqual([]);

    const error = await runScheduledOffsiteCopy(
      h.deps,
      { finalAttempt: true },
      { env, connect: noBuckets }
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(OffsiteCopyNotConfiguredError);
    expect(h.errors.reported).toEqual([
      expect.objectContaining({
        error,
        tags: { job: "offsite_copy", where: "offsite_copy" },
        extra: {
          problems: expect.arrayContaining([
            "OFFSITE_SOURCE_BUCKETS is not set",
            "B2_APPLICATION_KEY is not set",
          ]),
        },
      }),
    ]);
    expect(JSON.stringify(h.errors.reported)).not.toContain("b2-key-id");
  });

  it("treats a run without pg-boss's attempt details as the final attempt", async () => {
    const h = await createHarness();

    await expect(
      runScheduledOffsiteCopy(h.deps, undefined, {
        env: { APP_ENV: "production" },
        connect: noBuckets,
      })
    ).rejects.toThrow(OffsiteCopyNotConfiguredError);
    expect(h.errors.reported).toHaveLength(1);
  });

  it("copies through the buckets its settings open", async () => {
    const h = await createHarness();
    const r2 = new FakeCopyBucket({ clock: h.clock });
    const b2 = new FakeCopyBucket({ clock: h.clock });
    await r2.write({
      bucket: "foa-files-prod",
      key: "avatar/a",
      body: streamOf(new Uint8Array([1, 2, 3])),
      sizeBytes: 3,
      contentType: "image/png",
      contentMd5: null,
      metadata: {},
    });
    const opened: { r2: S3BucketConfig; b2: S3BucketConfig }[] = [];

    await runScheduledOffsiteCopy(
      h.deps,
      { finalAttempt: false },
      {
        env: PRODUCTION,
        connect: (settings) => {
          opened.push(settings);
          return { source: r2, target: b2 };
        },
      }
    );

    expect(opened).toEqual([
      {
        r2: expect.objectContaining({ accessKeyId: "r2-read-key" }),
        b2: expect.objectContaining({ accessKeyId: "b2-key-id" }),
      },
    ]);
    expect(
      await b2.exists({ bucket: "foa-offsite", key: "foa-files-prod/avatar/a" })
    ).toBe(true);
  });

  /** R2 whose listing names one key twice, so the plan throws. */
  function twiceListed(r2: FakeCopyBucket): CopyBucket {
    return {
      read: (input) => r2.read(input),
      write: (input) => r2.write(input),
      delete: (input) => r2.delete(input),
      exists: (input) => r2.exists(input),
      async *list() {
        const object = {
          key: "avatar/a",
          etag: "0123456789abcdef0123456789abcdef",
          sizeBytes: 3,
          lastModified: new Date("2027-01-15T00:00:00Z"),
        };
        yield object;
        yield object;
      },
    };
  }

  it("reports an unexpected failure on the final attempt only", async () => {
    const h = await createHarness();
    const b2 = new FakeCopyBucket({ clock: h.clock });
    const connect = () => ({
      source: twiceListed(new FakeCopyBucket({ clock: h.clock })),
      target: b2,
    });

    await expect(
      runScheduledOffsiteCopy(
        h.deps,
        { finalAttempt: false },
        { env: PRODUCTION, connect }
      )
    ).rejects.toThrow("twice");
    expect(h.errors.reported).toEqual([]);

    const error = await runScheduledOffsiteCopy(
      h.deps,
      { finalAttempt: true },
      { env: PRODUCTION, connect }
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(Error);
    expect(h.errors.reported).toEqual([
      expect.objectContaining({
        error,
        tags: { job: "offsite_copy", where: "offsite_copy" },
      }),
    ]);
  });

  it("reports an incomplete run once, not again as unexpected", async () => {
    const h = await createHarness();
    const failing: CopyBucket = {
      read: async () => null,
      write: async () => {},
      delete: async () => {},
      exists: async () => false,
      // eslint-disable-next-line require-yield
      async *list() {
        throw new Error("R2 is down");
      },
    };

    await expect(
      runScheduledOffsiteCopy(
        h.deps,
        { finalAttempt: true },
        {
          env: PRODUCTION,
          connect: () => ({
            source: failing,
            target: new FakeCopyBucket({ clock: h.clock }),
          }),
        }
      )
    ).rejects.toThrow(OffsiteCopyIncompleteError);
    expect(h.errors.reported).toHaveLength(1);
  });
});
