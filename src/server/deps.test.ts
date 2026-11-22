import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createTestDb } from "@/test/db";
import { EICAR_TEST_BYTES } from "@/test/eicar";
import { FakeClock } from "@/test/fakes/clock";

import type { E164Phone } from "@/lib/phone";

import {
  codeRequestLimitsFor,
  contactLimitsFor,
  DEVELOPMENT_AUTH_SECRET,
  emailSignInReady,
  filesConfigFor,
  localDiskStorageFor,
  scannerFor,
  settingsFor,
  smsSenderFor,
  storageFor,
} from "./deps";
import { CONTACT_RATE_LIMITS } from "./modules/contact/domain/submission";
import { CODE_REQUEST_LIMITS } from "./identity/settings";
import { SmsNotConfiguredError } from "./ports/sms";
import { readCapturedSms } from "./ports/sms-capture";
import { systemClock } from "./ports/clock";
import { databaseSettings } from "./modules/settings";
import { setting } from "./db/schema";
import { StorageNotConfiguredError } from "./ports/storage";
import { diskStorage, type DiskStorage } from "./ports/storage-disk";

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

describe("contactLimitsFor", () => {
  it.each(["staging", "production"] as const)(
    "keeps FOA's contact form limits on %s",
    (appEnv) => {
      expect(contactLimitsFor(appEnv)).toEqual(CONTACT_RATE_LIMITS);
    }
  );

  it.each(["local", "preview"] as const)(
    "lets one IP send many more on %s, where every E2E run shares the CI's address",
    (appEnv) => {
      expect(contactLimitsFor(appEnv)).toEqual({
        perIpPerHour: 100,
        perEmailPerDay: CONTACT_RATE_LIMITS.perEmailPerDay,
      });
    }
  );
});

describe("codeRequestLimitsFor", () => {
  it.each(["staging", "production"] as const)(
    "keeps FOA's sign-in code limits on %s",
    (appEnv) => {
      expect(codeRequestLimitsFor(appEnv)).toEqual(CODE_REQUEST_LIMITS);
    }
  );

  it.each(["local", "preview"] as const)(
    "lets one IP ask for many more codes on %s, where every E2E run shares the CI's address",
    (appEnv) => {
      expect(codeRequestLimitsFor(appEnv)).toEqual({
        ...CODE_REQUEST_LIMITS,
        perIp: 200,
      });
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

  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const OBJECT = { bucket: "local", key: "local/incoming/object" };

  async function uploadUrl(storage: DiskStorage) {
    return (
      await storage.presignPut({
        ...OBJECT,
        contentType: "image/png",
        contentLength: PNG.length,
        expiresInSeconds: 60,
      })
    ).url;
  }

  const putTo = (storage: DiskStorage, url: string) =>
    storage.receive(
      url,
      new Headers({
        "content-type": "image/png",
        "content-length": String(PNG.length),
      }),
      new Blob([PNG]).stream()
    );

  function localStore(root: string, env: Record<string, string> = {}) {
    const storage = localDiskStorageFor({ ...LOCAL, ...env }, root);
    if (!storage) throw new Error("no disk store");
    return storage;
  }

  it("signs with a private key of its own, never a public one", async () => {
    const root = mkdtempSync(join(tmpdir(), "foa-local-key-"));
    try {
      const envs: Record<string, string>[] = [
        {},
        { BETTER_AUTH_SECRET: DEVELOPMENT_AUTH_SECRET },
      ];
      for (const env of envs) {
        const forger = diskStorage(
          {
            root,
            baseUrl: "http://localhost:3000/api/local-storage/",
            secret: DEVELOPMENT_AUTH_SECRET,
          },
          systemClock
        );
        expect(
          await putTo(localStore(root, env), await uploadUrl(forger))
        ).toEqual({
          ok: false,
          error: "bad_signature",
        });
      }
      const keyFile = readdirSync(root).filter((name) => name.includes("key"));
      expect(keyFile).toHaveLength(1);
      expect(statSync(join(root, keyFile[0]!)).mode & 0o077).toBe(0);
      expect(statSync(root).mode & 0o077).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("shares its key across the app's handlers and keeps it per installation", async () => {
    const one = mkdtempSync(join(tmpdir(), "foa-local-key-"));
    const other = mkdtempSync(join(tmpdir(), "foa-local-key-"));
    try {
      const url = await uploadUrl(localStore(one));
      expect(await putTo(localStore(other), url)).toEqual({
        ok: false,
        error: "bad_signature",
      });
      // Another request's handler, built afresh for the same installation.
      expect(await putTo(localStore(one), url)).toEqual({ ok: true });
    } finally {
      rmSync(one, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
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

  // APP_ENV defaults to local, so a worker started without it would
  // otherwise pass every real upload in a real bucket.
  it("passes nothing on a local run with R2 but without clamd", async () => {
    const scanner = scannerFor({ APP_ENV: "local", CLAMD_PORT: 3310, ...R2 });

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

/** SES's variables as production sets them (src/env.schema.ts). */
const SES = {
  SES_REGION: "ap-south-1",
  SES_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
  SES_SECRET_ACCESS_KEY: "test-ses-secret-access-key",
  SES_FROM: "Friends of Animals <no-reply@friendsofanimals.dev>",
};

describe("emailSignInReady", () => {
  it.each(["local", "preview", "staging"] as const)(
    "is ready on %s, which captures every email, with or without SES",
    (appEnv) => {
      expect(
        emailSignInReady({ APP_ENV: appEnv, SES_PRODUCTION_ACCESS: false })
      ).toBe(true);
      expect(
        emailSignInReady({
          APP_ENV: appEnv,
          ...SES,
          SES_PRODUCTION_ACCESS: true,
        })
      ).toBe(true);
    }
  );

  it("is not ready in production without SES, so sign-in shows it's opening soon", () => {
    expect(
      emailSignInReady({ APP_ENV: "production", SES_PRODUCTION_ACCESS: false })
    ).toBe(false);
    // Production access alone sends nothing.
    expect(
      emailSignInReady({ APP_ENV: "production", SES_PRODUCTION_ACCESS: true })
    ).toBe(false);
  });

  it("waits in production for SES to leave the sandbox, even with its keys", () => {
    expect(
      emailSignInReady({
        APP_ENV: "production",
        ...SES,
        SES_PRODUCTION_ACCESS: false,
      })
    ).toBe(false);
  });

  it("is ready in production once SES is configured and out of the sandbox", () => {
    expect(
      emailSignInReady({
        APP_ENV: "production",
        ...SES,
        SES_PRODUCTION_ACCESS: true,
      })
    ).toBe(true);
  });
});

describe("settingsFor", () => {
  async function storedSettings(values: Record<string, unknown>) {
    const db = await createTestDb();
    const updatedAt = new Date("2026-11-22T00:00:00Z");
    for (const [key, value] of Object.entries(values)) {
      await db.insert(setting).values({ key, value, updatedAt });
    }
    return databaseSettings(db);
  }

  it("keeps email sign-in off while it isn't ready, even when switched on", async () => {
    const settings = settingsFor(
      await storedSettings({ "auth.emailSignIn": true, "sms.enabled": true }),
      { emailSignInReady: false }
    );

    expect(await settings.get("auth.emailSignIn")).toBe(false);
    expect(await settings.get("sms.enabled")).toBe(true);
  });

  it("reads email sign-in from the settings once it is ready: on by default, off when switched off", async () => {
    const byDefault = settingsFor(await storedSettings({}), {
      emailSignInReady: true,
    });
    const switchedOff = settingsFor(
      await storedSettings({ "auth.emailSignIn": false }),
      { emailSignInReady: true }
    );

    expect(await byDefault.get("auth.emailSignIn")).toBe(true);
    expect(await switchedOff.get("auth.emailSignIn")).toBe(false);
  });
});
