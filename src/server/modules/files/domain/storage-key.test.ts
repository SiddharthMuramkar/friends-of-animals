import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  quarantineKeyFor,
  storageKeyFor,
  storagePrefixFor,
  storagePrefixForDatabase,
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
  it("maps a PR database to the PR's prefix", () => {
    expect(storagePrefixForDatabase("foa_pr_12")).toBe("pr-12/");
  });

  it("maps a branch database to its hash's prefix", () => {
    expect(storagePrefixForDatabase("foa_br_ticket_63_storage_0a1b2c3d")).toBe(
      "br-0a1b2c3d/"
    );
    expect(storagePrefixForDatabase("foa_br_0a1b2c3d")).toBe("br-0a1b2c3d/");
  });

  it("agrees with the prefix a preview writes under", () => {
    for (const env of [
      { APP_ENV: "preview", VERCEL_GIT_PULL_REQUEST_ID: "7" },
      { APP_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feat/a.b" },
      { APP_ENV: "preview", VERCEL_GIT_COMMIT_REF: "###" },
    ]) {
      const pr = env.VERCEL_GIT_PULL_REQUEST_ID;
      const name = pr
        ? `foa_pr_${pr}`
        : (() => {
            const ref = env.VERCEL_GIT_COMMIT_REF ?? "";
            const slug = ref
              .toLowerCase()
              .replaceAll(/[^a-z0-9]+/g, "_")
              .replace(/^_+/, "")
              .replace(/_+$/, "");
            return slug === ""
              ? `foa_br_${hash8(ref)}`
              : `foa_br_${slug}_${hash8(ref)}`;
          })();
      expect(storagePrefixForDatabase(name)).toBe(storagePrefixFor(env));
    }
  });

  it("refuses anything that isn't a preview database", () => {
    for (const name of [
      "foa",
      "foa_seed",
      "postgres",
      "",
      "foa_pr_",
      "foa_pr_0",
      "foa_pr_12x",
      "foa_br_",
      "foa_br_short",
      "foa_br_ticket_ABCDEF12",
      "staging",
      "foa_pr_12/../x",
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
