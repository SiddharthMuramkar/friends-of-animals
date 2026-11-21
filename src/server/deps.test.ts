import { describe, expect, it } from "vitest";

import { createTestDb } from "@/test/db";
import { FakeClock } from "@/test/fakes/clock";

import { emailSenderFor, filesConfigFor, storageFor } from "./deps";
import { EmailNotConfiguredError } from "./ports/email";
import { readCapturedEmail } from "./ports/email-capture";
import { StorageNotConfiguredError } from "./ports/storage";

const message = { to: "asha@example.test", subject: "Code", text: "123456" };

describe("emailSenderFor", () => {
  it.each(["local", "preview", "staging"] as const)(
    "captures email on %s instead of sending it",
    async (appEnv) => {
      const deps = { db: await createTestDb(), clock: new FakeClock() };
      const sender = emailSenderFor(appEnv, deps);

      await sender.send(message);

      const inbox = await readCapturedEmail(deps, { to: message.to });
      expect(inbox.map((received) => received.text)).toEqual(["123456"]);
    }
  );

  it("never captures in production, and refuses while SES is not wired", async () => {
    const deps = { db: await createTestDb(), clock: new FakeClock() };
    const sender = emailSenderFor("production", deps);

    await expect(sender.send(message)).rejects.toBeInstanceOf(
      EmailNotConfiguredError
    );
    expect(await readCapturedEmail(deps, { to: message.to })).toEqual([]);
  });
});

const R2 = {
  R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_ACCESS_KEY_ID: "test-access-key-id",
  R2_SECRET_ACCESS_KEY: "test-secret-access-key",
  R2_BUCKET: "foa-files-nonprod",
};

describe("storageFor", () => {
  it("refuses every call while R2 isn't configured", async () => {
    // Every environment, production included, until its bucket exists.
    const storage = storageFor({});

    await expect(
      storage.head({ bucket: "b", key: "local/a" })
    ).rejects.toBeInstanceOf(StorageNotConfiguredError);
  });

  it("stores on the configured R2 account", async () => {
    const storage = storageFor(R2);

    const { url } = await storage.presignPut({
      bucket: R2.R2_BUCKET,
      key: "staging/test_upload/01938a00-1234-7abc-8def-0123456789ab",
      contentType: "image/png",
      contentLength: 3,
      expiresInSeconds: 600,
    });
    expect(new URL(url).origin).toBe(
      `https://${R2.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    );
  });
});

describe("filesConfigFor", () => {
  it("puts a PR preview's files under its prefix in the configured bucket", () => {
    expect(
      filesConfigFor({
        APP_ENV: "preview",
        VERCEL_GIT_PULL_REQUEST_ID: "12",
        ...R2,
      })
    ).toEqual({
      bucket: "foa-files-nonprod",
      keyPrefix: "pr-12/",
      appEnv: "preview",
    });
  });

  it("uses no prefix in production", () => {
    expect(filesConfigFor({ APP_ENV: "production", ...R2 }).keyPrefix).toBe("");
  });
});
