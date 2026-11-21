import { createServer, type AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import { createTestDb } from "@/test/db";
import { EICAR_TEST_BYTES } from "@/test/eicar";
import { FakeClock } from "@/test/fakes/clock";

import type { E164Phone } from "@/lib/phone";

import {
  filesConfigFor,
  localDiskStorageFor,
  scannerFor,
  settingsFor,
  smsSenderFor,
  storageFor,
} from "./deps";
import { SmsNotConfiguredError } from "./ports/sms";
import { readCapturedSms } from "./ports/sms-capture";
import { StorageNotConfiguredError } from "./ports/storage";

const sms = {
  to: "+919876543210" as E164Phone,
  template: "sign-in-code" as const,
  vars: { code: "123456", minutes: "10" },
  text: "Your code is 123456",
};

const MSG91 = { authKey: "msg91-key", otpTemplateId: "otp-template" };

/** A fetch that counts calls and accepts every message. */
function countingFetch() {
  const counter = { calls: 0 };
  const fetch = (async () => {
    counter.calls += 1;
    return Response.json({ type: "success", message: "request-id" });
  }) as typeof globalThis.fetch;
  return { fetch, counter };
}

describe("smsSenderFor", () => {
  it.each(["local", "preview", "staging"] as const)(
    "captures SMS on %s and never calls MSG91, even with its keys",
    async (appEnv) => {
      const deps = { db: await createTestDb(), clock: new FakeClock() };
      const { fetch, counter } = countingFetch();
      const sender = smsSenderFor(appEnv, deps, MSG91, fetch);

      await sender.send(sms);

      const inbox = await readCapturedSms(deps, { to: sms.to });
      expect(inbox.map((received) => received.text)).toEqual([
        "Your code is 123456",
      ]);
      expect(counter.calls).toBe(0);
    }
  );

  it("sends through MSG91 in production when its keys are set", async () => {
    const deps = { db: await createTestDb(), clock: new FakeClock() };
    const { fetch, counter } = countingFetch();

    await smsSenderFor("production", deps, MSG91, fetch).send(sms);

    expect(counter.calls).toBe(1);
    expect(await readCapturedSms(deps, { to: sms.to })).toEqual([]);
  });

  it("refuses in production while MSG91 is not configured", async () => {
    const deps = { db: await createTestDb(), clock: new FakeClock() };
    const { fetch, counter } = countingFetch();

    for (const config of [{}, { authKey: "msg91-key" }]) {
      const sender = smsSenderFor("production", deps, config, fetch);
      await expect(sender.send(sms)).rejects.toBeInstanceOf(
        SmsNotConfiguredError
      );
    }
    expect(counter.calls).toBe(0);
    expect(await readCapturedSms(deps, { to: sms.to })).toEqual([]);
  });
});

describe("settingsFor", () => {
  it.each([
    ["local", true],
    ["preview", true],
    ["staging", false],
    ["production", false],
  ] as const)("reads sms.enabled on %s as %s", async (appEnv, enabled) => {
    expect(await settingsFor(appEnv).get("sms.enabled")).toBe(enabled);
  });

  it.each(["local", "preview", "staging", "production"] as const)(
    "keeps FOA's ceiling on texts on %s: 200 an hour, 1,000 a day",
    async (appEnv) => {
      const settings = settingsFor(appEnv);

      expect(await settings.get("sms.maxPerHour")).toBe(200);
      expect(await settings.get("sms.maxPerDay")).toBe(1000);
    }
  );
});

const R2 = {
  R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_ACCESS_KEY_ID: "test-access-key-id",
  R2_SECRET_ACCESS_KEY: "test-secret-access-key",
  R2_BUCKET: "foa-files-nonprod",
};

const LOCAL = { APP_ENV: "local", APP_URL: "http://localhost:3000" } as const;
const DEPLOYED = ["preview", "staging", "production"] as const;
const UPLOAD = {
  key: "local/test_upload/01938a00-1234-7abc-8def-0123456789ab",
  contentType: "image/png",
  contentLength: 3,
  expiresInSeconds: 600,
};

describe("storageFor", () => {
  it.each(DEPLOYED)(
    "refuses every call on %s while R2 isn't configured",
    async (appEnv) => {
      // Production included, until its bucket exists.
      const storage = storageFor({
        APP_ENV: appEnv,
        APP_URL: "https://friendsofanimals.example",
      });

      await expect(
        storage.head({ bucket: "b", key: "local/a" })
      ).rejects.toBeInstanceOf(StorageNotConfiguredError);
    }
  );

  it("keeps a local run's files on this machine, through the app's own URLs", async () => {
    const storage = storageFor(LOCAL);

    const { url } = await storage.presignPut({ bucket: "local", ...UPLOAD });

    expect(url.startsWith("http://localhost:3000/api/local-storage/")).toBe(
      true
    );
  });

  it.each(["local", "staging"] as const)(
    "stores on the configured R2 account on %s",
    async (appEnv) => {
      const storage = storageFor({
        APP_ENV: appEnv,
        APP_URL: "http://localhost:3000",
        ...R2,
      });

      const { url } = await storage.presignPut({
        bucket: R2.R2_BUCKET,
        ...UPLOAD,
      });
      expect(new URL(url).origin).toBe(
        `https://${R2.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
      );
    }
  );
});

describe("localDiskStorageFor", () => {
  it("is only for a local run without R2", () => {
    expect(localDiskStorageFor(LOCAL)).not.toBeNull();
    expect(localDiskStorageFor({ ...LOCAL, ...R2 })).toBeNull();
    for (const appEnv of DEPLOYED) {
      expect(localDiskStorageFor({ ...LOCAL, APP_ENV: appEnv })).toBeNull();
    }
  });
});

const streamOf = (bytes: Uint8Array) => new Blob([bytes.slice()]).stream();
const HARMLESS = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe("scannerFor", () => {
  it("scans on a local run without clamd, and flags the EICAR test file", async () => {
    const scanner = scannerFor({ APP_ENV: "local", CLAMD_PORT: 3310 });

    expect(await scanner.scan(streamOf(HARMLESS))).toEqual({
      verdict: "clean",
    });
    expect(await scanner.scan(streamOf(EICAR_TEST_BYTES))).toMatchObject({
      verdict: "infected",
    });
  });

  it.each(DEPLOYED)("passes nothing on %s without clamd", async (appEnv) => {
    const scanner = scannerFor({ APP_ENV: appEnv, CLAMD_PORT: 3310 });

    expect(await scanner.scan(streamOf(HARMLESS))).toMatchObject({
      verdict: "error",
    });
  });

  it("asks clamd once CLAMD_HOST is set, on a local run too", async () => {
    // A "clamd" that hangs up on every connection: only the ClamAV
    // adapter would notice, and it gives no verdict.
    const server = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const { port } = server.address() as AddressInfo;
    try {
      const scanner = scannerFor({
        APP_ENV: "local",
        CLAMD_HOST: "127.0.0.1",
        CLAMD_PORT: port,
      });

      expect(await scanner.scan(streamOf(HARMLESS))).toMatchObject({
        verdict: "error",
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
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

  it("keeps a local run's files under local/ in the disk store's bucket without R2", () => {
    expect(filesConfigFor({ APP_ENV: "local" })).toEqual({
      bucket: "local",
      keyPrefix: "local/",
      appEnv: "local",
    });
  });
});
