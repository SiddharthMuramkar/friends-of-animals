import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalStorage, resolveSafePath } from "./local.server";
import { isAllowedImageType, makeUploadKey } from "./index.server";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "storage-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("local storage driver", () => {
  it("puts a Buffer, returns key and /files url, and deletes it", async () => {
    const storage = createLocalStorage(dir);
    const result = await storage.put("animals/a.png", Buffer.from("hello"));
    expect(result).toEqual({ key: "animals/a.png", url: "/files/animals/a.png" });
    expect(storage.url(result.key)).toBe("/files/animals/a.png");
    expect(await readFile(path.join(dir, "animals/a.png"), "utf8")).toBe("hello");

    await storage.delete(result.key);
    await expect(stat(path.join(dir, "animals/a.png"))).rejects.toThrow();
    // deleting a missing file is a no-op
    await expect(storage.delete(result.key)).resolves.toBeUndefined();
  });

  it("accepts Blob and ReadableStream bodies", async () => {
    const storage = createLocalStorage(dir);
    await storage.put("b.txt", new Blob(["blob-data"]));
    expect(await readFile(path.join(dir, "b.txt"), "utf8")).toBe("blob-data");

    await storage.put("nested/deep/s.txt", new Blob(["stream-data"]).stream());
    expect(await readFile(path.join(dir, "nested/deep/s.txt"), "utf8")).toBe("stream-data");
  });

  it.each([
    "../escape.txt",
    "animals/../../escape.txt",
    "/etc/passwd",
    "a\\..\\b",
    "",
    "a//b",
    "./a",
    "a\0b",
  ])("rejects unsafe key %j", async (key) => {
    const storage = createLocalStorage(dir);
    await expect(storage.put(key, Buffer.from("x"))).rejects.toThrow(/Invalid storage key/);
    await expect(storage.delete(key)).rejects.toThrow(/Invalid storage key/);
    expect(() => resolveSafePath(dir, key)).toThrow();
  });
});

describe("upload helpers", () => {
  it("makeUploadKey builds prefix/<uuid>.<ext> with a sanitized extension", () => {
    expect(makeUploadKey("animals", "Photo.JPEG")).toMatch(/^animals\/[0-9a-f-]{36}\.jpg$/);
    expect(makeUploadKey("animals", "x.p<n>g")).toMatch(/^animals\/[0-9a-f-]{36}\.png$/);
    expect(makeUploadKey("../evil", "noext")).toMatch(/^evil\/[0-9a-f-]{36}$/);
  });

  it("isAllowedImageType allowlists image MIME types", () => {
    expect(isAllowedImageType("image/jpeg")).toBe(true);
    expect(isAllowedImageType("image/avif")).toBe(true);
    expect(isAllowedImageType("image/svg+xml")).toBe(false);
    expect(isAllowedImageType("text/html")).toBe(false);
    expect(isAllowedImageType(null)).toBe(false);
  });
});
