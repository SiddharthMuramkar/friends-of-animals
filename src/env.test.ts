import { afterEach, describe, expect, it, vi } from "vitest";

import { databaseUrl, env, parseEnv, resetEnvCache, siteUrl } from "./env";

const DATABASE_URL = "postgres://foa:foa@localhost:5432/foa";

describe("parseEnv", () => {
  it("applies defaults and needs no database at parse time", () => {
    const config = parseEnv({});
    expect(config.NODE_ENV).toBe("development");
    expect(config.APP_ENV).toBe("local");
    expect(config.DATABASE_URL).toBeUndefined();
    expect(config.DIRECT_URL).toBeUndefined();
  });

  it("treats empty strings as unset", () => {
    const config = parseEnv({ DATABASE_URL: "", APP_ENV: "" });
    expect(config.DATABASE_URL).toBeUndefined();
    expect(config.APP_ENV).toBe("local");
  });

  it("accepts every APP_ENV and rejects anything else", () => {
    for (const appEnv of ["local", "preview", "staging", "production"]) {
      expect(parseEnv({ APP_ENV: appEnv }).APP_ENV).toBe(appEnv);
    }
    expect(() => parseEnv({ APP_ENV: "prod" })).toThrow(/APP_ENV/);
  });

  it("only accepts postgres URLs for DATABASE_URL and DIRECT_URL", () => {
    expect(parseEnv({ DATABASE_URL }).DATABASE_URL).toBe(DATABASE_URL);
    expect(
      parseEnv({ DIRECT_URL: "postgresql://m:p@db.example.org:6432/foa" })
        .DIRECT_URL
    ).toBe("postgresql://m:p@db.example.org:6432/foa");
    expect(() => parseEnv({ DATABASE_URL: "mysql://localhost/foa" })).toThrow(
      /DATABASE_URL/
    );
    expect(() => parseEnv({ DIRECT_URL: "not a url" })).toThrow(/DIRECT_URL/);
  });

  it("requires APP_URL to be an http(s) URL", () => {
    expect(() => parseEnv({ APP_URL: "example.org" })).toThrow(/APP_URL/);
    expect(parseEnv({ APP_URL: "https://foa.shipped-it.dev" }).APP_URL).toBe(
      "https://foa.shipped-it.dev"
    );
  });
});

describe("databaseUrl", () => {
  it("returns DATABASE_URL", () => {
    expect(databaseUrl(parseEnv({ DATABASE_URL }))).toBe(DATABASE_URL);
  });

  it("throws a helpful error when DATABASE_URL is missing", () => {
    expect(() => databaseUrl(parseEnv({}))).toThrow(/DATABASE_URL is not set/);
  });
});

describe("siteUrl", () => {
  it("falls back to localhost", () => {
    expect(siteUrl(parseEnv({})).href).toBe("http://localhost:3000/");
  });

  it("uses APP_URL when set", () => {
    const config = parseEnv({ APP_URL: "https://example.org" });
    expect(siteUrl(config).origin).toBe("https://example.org");
  });
});

describe("env", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("reads process.env once and caches the result", () => {
    vi.stubEnv("APP_ENV", "staging");
    expect(env().APP_ENV).toBe("staging");
    vi.stubEnv("APP_ENV", "preview");
    expect(env().APP_ENV).toBe("staging");
    resetEnvCache();
    expect(env().APP_ENV).toBe("preview");
  });
});
