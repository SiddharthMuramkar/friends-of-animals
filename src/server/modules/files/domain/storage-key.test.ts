import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { previewDatabaseName } from "@/server/db/database-url";

import { FILE_PURPOSES } from "./purposes";
import {
  publicBucketFor,
  publicCopyKeyFor,
  quarantineKeyFor,
  RESERVED_FOLDERS,
  storageKeyFor,
  storagePrefixFor,
  storagePrefixForDatabase,
  storagePrefixOf,
  uploadKeyFor,
} from "./storage-key";

const hash8 = (ref: string) =>
  createHash("sha256").update(ref).digest("hex").slice(0, 8);

const FILE_ID = "01938a00-1234-7abc-8def-0123456789ab";

describe("storagePrefixFor", () => {
  it("uses no prefix in production, which has its own buckets", () => {
    expect(storagePrefixFor({ APP_ENV: "production" })).toBe("");
  });

  it("gives staging and local runs their own prefix", () => {
    expect(storagePrefixFor({ APP_ENV: "staging" })).toBe("staging/");
    expect(storagePrefixFor({ APP_ENV: "local" })).toBe("local/");
    expect(storagePrefixFor({})).toBe("local/");
  });

  it("gives a PR's preview the PR's prefix", () => {
    expect(
      storagePrefixFor({
        APP_ENV: "preview",
        VERCEL_GIT_PULL_REQUEST_ID: "141",
        VERCEL_GIT_COMMIT_REF: "ticket/63-storage",
      })
    ).toBe("pr-141/");
  });

  it("gives a branch preview the branch hash its database is named with", () => {
    const ref = "ticket/63-storage";
    expect(
      storagePrefixFor({ APP_ENV: "preview", VERCEL_GIT_COMMIT_REF: ref })
    ).toBe(`br-${hash8(ref)}/`);
  });

  it("throws for a preview it can't name, as the database does", () => {
    expect(() => storagePrefixFor({ APP_ENV: "preview" })).toThrow(
      /VERCEL_GIT_PULL_REQUEST_ID/
    );
  });
});

describe("storagePrefixForDatabase", () => {
  // Preview databases are named <base>_<fp>, where <fp> is the migrations
  // fingerprint (src/server/db/database-url.ts). Every database a PR or
  // branch has had maps to the same prefix: the sweeper drops them together.
  it("maps a PR database to the PR's prefix", () => {
    expect(storagePrefixForDatabase("foa_pr_12_9f8e7d6c")).toBe("pr-12/");
  });

  it("maps a branch database to its hash's prefix", () => {
    expect(
      storagePrefixForDatabase("foa_br_ticket_63_storage_0a1b2c3d_9f8e7d6c")
    ).toBe("br-0a1b2c3d/");
    expect(storagePrefixForDatabase("foa_br_0a1b2c3d_9f8e7d6c")).toBe(
      "br-0a1b2c3d/"
    );
  });

  it("agrees with the prefix a preview writes under", () => {
    for (const env of [
      { APP_ENV: "preview", VERCEL_GIT_PULL_REQUEST_ID: "7" },
      { APP_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feat/a.b" },
      { APP_ENV: "preview", VERCEL_GIT_COMMIT_REF: "###" },
      { APP_ENV: "preview", VERCEL_GIT_COMMIT_REF: `feat/${"x".repeat(80)}` },
    ]) {
      expect(storagePrefixForDatabase(previewDatabaseName(env))).toBe(
        storagePrefixFor(env)
      );
    }
  });

  it("refuses anything that isn't a preview database", () => {
    for (const name of [
      "foa",
      "foa_seed",
      "postgres",
      "",
      "foa_pr_",
      "foa_pr_0_9f8e7d6c",
      "foa_pr_12x_9f8e7d6c",
      "foa_pr_12_9F8E7D6C",
      "foa_pr_12_9f8e7d6",
      "foa_br_",
      "foa_br_short_9f8e7d6c",
      "foa_br_ticket_ABCDEF12_9f8e7d6c",
      "staging",
      "foa_pr_12/../x",
      // Named before the fingerprint: made before any file was stored.
      "foa_pr_12",
      "foa_br_ticket_63_storage_0a1b2c3d",
    ]) {
      expect(storagePrefixForDatabase(name)).toBeNull();
    }
  });
});

describe("storageKeyFor", () => {
  it("puts the file under its environment prefix and purpose", () => {
    expect(
      storageKeyFor({
        prefix: "pr-12/",
        purpose: "test_upload",
        fileId: FILE_ID,
      })
    ).toBe(`pr-12/test_upload/${FILE_ID}`);
    expect(
      storageKeyFor({ prefix: "", purpose: "test_upload", fileId: FILE_ID })
    ).toBe(`test_upload/${FILE_ID}`);
  });

  it("refuses an id or prefix that could escape its folder", () => {
    for (const fileId of ["../x", "a/b", "", FILE_ID.toUpperCase()]) {
      expect(() =>
        storageKeyFor({ prefix: "local/", purpose: "test_upload", fileId })
      ).toThrow();
    }
    for (const prefix of ["local", "/local/", "../", "a/b/", "Local/"]) {
      expect(() =>
        storageKeyFor({ prefix, purpose: "test_upload", fileId: FILE_ID })
      ).toThrow();
    }
  });
});

describe("quarantineKeyFor", () => {
  it("moves a file to the quarantine folder under the same prefix", () => {
    expect(quarantineKeyFor({ prefix: "staging/", fileId: FILE_ID })).toBe(
      `staging/quarantine/${FILE_ID}`
    );
  });
});

describe("uploadKeyFor", () => {
  it("has the browser PUT to the incoming folder, never the storage key", () => {
    expect(uploadKeyFor({ prefix: "pr-12/", fileId: FILE_ID })).toBe(
      `pr-12/incoming/${FILE_ID}`
    );
    expect(uploadKeyFor({ prefix: "", fileId: FILE_ID })).toBe(
      `incoming/${FILE_ID}`
    );
    for (const purpose of FILE_PURPOSES) {
      expect(uploadKeyFor({ prefix: "local/", fileId: FILE_ID })).not.toBe(
        storageKeyFor({ prefix: "local/", purpose, fileId: FILE_ID })
      );
    }
  });

  it("refuses an id or prefix that could escape its folder", () => {
    expect(() => uploadKeyFor({ prefix: "local/", fileId: "../x" })).toThrow();
    expect(() => uploadKeyFor({ prefix: "../", fileId: FILE_ID })).toThrow();
  });
});

describe("the layout's own folders", () => {
  it("are never a purpose's name", () => {
    for (const purpose of FILE_PURPOSES) {
      expect(RESERVED_FOLDERS).not.toContain(purpose);
    }
    expect(() =>
      storageKeyFor({
        prefix: "local/",
        purpose: "incoming" as never,
        fileId: FILE_ID,
      })
    ).toThrow();
  });
});

describe("storagePrefixOf", () => {
  it("finds the environment prefix a file is stored under", () => {
    for (const prefix of ["", "local/", "pr-12/", "br-abcd1234/"]) {
      expect(
        storagePrefixOf({
          id: FILE_ID,
          purpose: "test_upload",
          storageKey: storageKeyFor({
            prefix,
            purpose: "test_upload",
            fileId: FILE_ID,
          }),
        })
      ).toBe(prefix);
    }
  });

  it("refuses a key that isn't the file's own", () => {
    expect(() =>
      storagePrefixOf({
        id: FILE_ID,
        purpose: "test_upload",
        storageKey: `local/quarantine/${FILE_ID}`,
      })
    ).toThrow();
  });
});

describe("publicBucketFor", () => {
  it("names the public bucket beside each private one", () => {
    expect(publicBucketFor("foa-files")).toBe("foa-files-public");
    expect(publicBucketFor("local")).toBe("local-public");
  });

  it("refuses a name that would be too long for a bucket", () => {
    expect(() => publicBucketFor("b".repeat(57))).toThrow();
    expect(publicBucketFor("b".repeat(56))).toHaveLength(63);
  });
});

describe("publicCopyKeyFor", () => {
  it("keeps public copies in a folder of their own, apart from the original", () => {
    expect(
      publicCopyKeyFor({
        prefix: "pr-12/",
        purpose: "cms_image",
        fileId: FILE_ID,
        kind: "post_cover_1200",
      })
    ).toBe(`pr-12/public/cms_image/${FILE_ID}/post_cover_1200.webp`);
    expect(RESERVED_FOLDERS).toContain("public");
  });

  it("refuses anything that isn't a prefix or a file id", () => {
    for (const unsafe of [
      { prefix: "../", fileId: FILE_ID },
      { prefix: "local/", fileId: "../../etc" },
    ]) {
      expect(() =>
        publicCopyKeyFor({
          ...unsafe,
          purpose: "cms_image",
          kind: "post_inline_960",
        })
      ).toThrow();
    }
  });
});
