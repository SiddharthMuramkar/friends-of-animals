import { describe, expect, it } from "vitest";

import { databaseUrl, siteUrl } from "./env";
import { envSchema, parseEnv } from "./env.schema";

const DATABASE_URL = "postgres://foa:foa@localhost:5432/foa";

describe("databaseUrl", () => {
  it("returns DATABASE_URL", () => {
    expect(databaseUrl(parseEnv(envSchema, { DATABASE_URL }))).toBe(
      DATABASE_URL
    );
  });

  it("throws a helpful error when DATABASE_URL is missing", () => {
    expect(() => databaseUrl(parseEnv(envSchema, {}))).toThrow(
      /DATABASE_URL is not set/
    );
  });
});

describe("siteUrl", () => {
  it("falls back to localhost", () => {
    expect(siteUrl(parseEnv(envSchema, {})).href).toBe(
      "http://localhost:3000/"
    );
  });

  it("uses APP_URL when set", () => {
    const config = parseEnv(envSchema, { APP_URL: "https://example.org" });
    expect(siteUrl(config).origin).toBe("https://example.org");
  });
});
