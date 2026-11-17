import { describe, expect, it, vi } from "vitest";
import { parseEnv } from "./env.server";

const base = { DATABASE_URL: "postgres://localhost/db", NODE_ENV: "development" };

describe("parseEnv", () => {
  it("applies defaults and warns about the dev session secret", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = parseEnv(base);
    expect(env.STORAGE_DRIVER).toBe("local");
    expect(env.UPLOAD_DIR).toBe("./data/uploads");
    expect(env.SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("requires DATABASE_URL", () => {
    expect(() => parseEnv({ NODE_ENV: "development" })).toThrow(/DATABASE_URL/);
  });

  it("requires BLOB_READ_WRITE_TOKEN when STORAGE_DRIVER=blob", () => {
    expect(() =>
      parseEnv({ ...base, SESSION_SECRET: "x".repeat(32), STORAGE_DRIVER: "blob" }),
    ).toThrow(/BLOB_READ_WRITE_TOKEN/);
    expect(
      parseEnv({
        ...base,
        SESSION_SECRET: "x".repeat(32),
        STORAGE_DRIVER: "blob",
        BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_abc",
      }).STORAGE_DRIVER,
    ).toBe("blob");
  });

  it("requires a 32+ char SESSION_SECRET in production", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "production" })).toThrow(/SESSION_SECRET/);
    expect(() =>
      parseEnv({ ...base, NODE_ENV: "production", SESSION_SECRET: "short" }),
    ).toThrow(/SESSION_SECRET/);
    expect(
      parseEnv({ ...base, NODE_ENV: "production", SESSION_SECRET: "y".repeat(32) })
        .SESSION_SECRET,
    ).toBe("y".repeat(32));
  });
});
