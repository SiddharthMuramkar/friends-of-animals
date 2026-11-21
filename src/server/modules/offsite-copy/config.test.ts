import { describe, expect, it } from "vitest";

import { readOffsiteSettings, readRestoreSettings } from "./config";

const ACCOUNT = "0123456789abcdef0123456789abcdef";

/** What worker-prod's environment holds once B2 and R2 exist. */
const PRODUCTION = {
  APP_ENV: "production",
  OFFSITE_SOURCE_BUCKETS: "foa-files-prod, foa-media-prod",
  R2_ACCOUNT_ID: ACCOUNT,
  OFFSITE_R2_ACCESS_KEY_ID: "r2-read-key",
  OFFSITE_R2_SECRET_ACCESS_KEY: "r2-read-secret",
  B2_S3_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com",
  B2_REGION: "eu-central-003",
  B2_BUCKET: "foa-offsite",
  B2_KEY_ID: "b2-key-id",
  B2_APPLICATION_KEY: "b2-application-key",
};

describe("readOffsiteSettings", () => {
  it("reads a production worker's buckets, keys and defaults", () => {
    expect(readOffsiteSettings(PRODUCTION)).toEqual({
      kind: "ready",
      config: {
        appEnv: "production",
        sourceBuckets: ["foa-files-prod", "foa-media-prod"],
        targetBucket: "foa-offsite",
        retention: { days: 30 },
        budgetMs: 2 * 60 * 60 * 1000,
        concurrency: 4,
      },
      r2: {
        endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`,
        region: "auto",
        accessKeyId: "r2-read-key",
        secretAccessKey: "r2-read-secret",
      },
      b2: {
        endpoint: "https://s3.eu-central-003.backblazeb2.com",
        region: "eu-central-003",
        accessKeyId: "b2-key-id",
        secretAccessKey: "b2-application-key",
        serverSideEncryption: "AES256",
      },
    });
  });

  it("keeps copies for OFFSITE_RETENTION_DAYS when it is set", () => {
    expect(
      readOffsiteSettings({ ...PRODUCTION, OFFSITE_RETENTION_DAYS: "45" })
    ).toMatchObject({ kind: "ready", config: { retention: { days: 45 } } });
  });

  it.each([
    ["staging", "staging"],
    ["preview", "preview"],
    ["local", "local"],
    [undefined, "local"],
  ])("needs nothing outside production (APP_ENV=%s)", (appEnv, expected) => {
    expect(readOffsiteSettings({ APP_ENV: appEnv })).toEqual({
      kind: "not_production",
      appEnv: expected,
    });
  });

  it("names every variable production is missing", () => {
    expect(readOffsiteSettings({ APP_ENV: "production" })).toEqual({
      kind: "invalid",
      problems: [
        "OFFSITE_SOURCE_BUCKETS is not set",
        "R2_ACCOUNT_ID is not set",
        "OFFSITE_R2_ACCESS_KEY_ID is not set",
        "OFFSITE_R2_SECRET_ACCESS_KEY is not set",
        "B2_S3_ENDPOINT is not set",
        "B2_REGION is not set",
        "B2_BUCKET is not set",
        "B2_KEY_ID is not set",
        "B2_APPLICATION_KEY is not set",
      ],
    });
  });

  it("treats an empty variable as unset", () => {
    expect(
      readOffsiteSettings({ ...PRODUCTION, B2_KEY_ID: "", B2_REGION: "  " })
    ).toEqual({
      kind: "invalid",
      problems: ["B2_REGION is not set", "B2_KEY_ID is not set"],
    });
  });

  it("says what is wrong with a value without repeating it", () => {
    const settings = readOffsiteSettings({
      ...PRODUCTION,
      OFFSITE_SOURCE_BUCKETS: "foa-files-prod,Not_A_Bucket",
      OFFSITE_RETENTION_DAYS: "0",
      R2_ACCOUNT_ID: "s3cr3t-looking-value",
      B2_S3_ENDPOINT: "http://s3.example.test",
    });

    expect(settings).toEqual({
      kind: "invalid",
      problems: [
        "OFFSITE_SOURCE_BUCKETS must list bucket names (3-63 of a-z, 0-9 and -), separated by commas",
        "OFFSITE_RETENTION_DAYS must be a whole number of days from 1 to 3650",
        "R2_ACCOUNT_ID must be 32 lower-case hex characters",
        "B2_S3_ENDPOINT must be an https URL",
      ],
    });
    expect(JSON.stringify(settings)).not.toContain("s3cr3t");
  });

  it("refuses a B2 bucket that is also a source", () => {
    expect(
      readOffsiteSettings({ ...PRODUCTION, B2_BUCKET: "foa-media-prod" })
    ).toEqual({
      kind: "invalid",
      problems: ["B2_BUCKET must not be one of OFFSITE_SOURCE_BUCKETS"],
    });
  });

  it("refuses an APP_ENV it doesn't know rather than guess it isn't production", () => {
    expect(readOffsiteSettings({ ...PRODUCTION, APP_ENV: "prod" })).toEqual({
      kind: "invalid",
      problems: ["APP_ENV must be one of local, preview, staging, production"],
    });
  });
});

describe("readRestoreSettings", () => {
  it("writes to R2 with the operator's restore key and reads B2's copies", () => {
    expect(
      readRestoreSettings({
        ...PRODUCTION,
        OFFSITE_RESTORE_R2_ACCESS_KEY_ID: "r2-write-key",
        OFFSITE_RESTORE_R2_SECRET_ACCESS_KEY: "r2-write-secret",
      })
    ).toEqual({
      ok: true,
      targetBucket: "foa-offsite",
      r2: {
        endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`,
        region: "auto",
        accessKeyId: "r2-write-key",
        secretAccessKey: "r2-write-secret",
      },
      b2: {
        endpoint: "https://s3.eu-central-003.backblazeb2.com",
        region: "eu-central-003",
        accessKeyId: "b2-key-id",
        secretAccessKey: "b2-application-key",
        serverSideEncryption: "AES256",
      },
    });
  });

  it("names what a restore is missing", () => {
    expect(readRestoreSettings({ ...PRODUCTION })).toEqual({
      ok: false,
      problems: [
        "OFFSITE_RESTORE_R2_ACCESS_KEY_ID is not set",
        "OFFSITE_RESTORE_R2_SECRET_ACCESS_KEY is not set",
      ],
    });
  });
});
