import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  buildEnvSchema,
  envSchema,
  migrationEnvSchema,
  parseEnv,
} from "./env.schema";

const DATABASE_URL = "postgres://foa:foa@localhost:5432/foa";

describe("parseEnv", () => {
  it("treats empty strings as unset", () => {
    const config = parseEnv(buildEnvSchema, { APP_ENV: "", APP_URL: "" });
    expect(config.APP_ENV).toBe("local");
    expect(config.APP_URL).toBe("http://localhost:3000");
    expect(() => parseEnv(envSchema, { DATABASE_URL: "" })).toThrow(
      /DATABASE_URL is not set/
    );
  });

  it("drops variables the schema doesn't name", () => {
    expect(parseEnv(buildEnvSchema, { HOME: "/root" })).not.toHaveProperty(
      "HOME"
    );
  });

  it("lists every invalid variable in one error", () => {
    const schema = z.object({ A: z.string(), B: z.string() });
    expect(() => parseEnv(schema, {})).toThrow(
      /^Invalid environment configuration:\n[\s\S]*\bA\b[\s\S]*\bB\b/
    );
  });
});

describe("buildEnvSchema", () => {
  it("needs nothing, so `next build` runs without a database or secrets", () => {
    expect(parseEnv(buildEnvSchema, {})).toEqual({
      NODE_ENV: "development",
      APP_ENV: "local",
      APP_URL: "http://localhost:3000",
    });
  });

  it("accepts every APP_ENV and rejects anything else", () => {
    for (const appEnv of ["local", "preview", "staging", "production"]) {
      expect(parseEnv(buildEnvSchema, { APP_ENV: appEnv }).APP_ENV).toBe(
        appEnv
      );
    }
    expect(() => parseEnv(buildEnvSchema, { APP_ENV: "prod" })).toThrow(
      /APP_ENV/
    );
  });

  it("requires APP_URL to be an http(s) URL", () => {
    expect(() => parseEnv(buildEnvSchema, { APP_URL: "example.org" })).toThrow(
      /APP_URL/
    );
    expect(
      parseEnv(buildEnvSchema, { APP_URL: "https://foa.shipped-it.dev" })
        .APP_URL
    ).toBe("https://foa.shipped-it.dev");
  });
});

describe("envSchema", () => {
  it("requires DATABASE_URL", () => {
    expect(() => parseEnv(envSchema, {})).toThrow(/DATABASE_URL is not set/);
  });

  it("only accepts a postgres URL for DATABASE_URL", () => {
    expect(parseEnv(envSchema, { DATABASE_URL }).DATABASE_URL).toBe(
      DATABASE_URL
    );
    expect(() =>
      parseEnv(envSchema, { DATABASE_URL: "mysql://localhost/foa" })
    ).toThrow(/must be a postgres:\/\/ .*\n.*at DATABASE_URL/);
  });

  it("includes the build variables", () => {
    const config = parseEnv(envSchema, {
      DATABASE_URL,
      APP_URL: "https://example.org",
    });
    expect(config.APP_URL).toBe("https://example.org");
    expect(config.APP_ENV).toBe("local");
  });
});

describe("migrationEnvSchema", () => {
  it("reads DIRECT_URL", () => {
    const url = "postgresql://migrator:p@db.example.org:6432/foa";
    expect(parseEnv(migrationEnvSchema, { DIRECT_URL: url }).DIRECT_URL).toBe(
      url
    );
  });

  it("requires DIRECT_URL and never falls back to DATABASE_URL", () => {
    expect(() => parseEnv(migrationEnvSchema, { DATABASE_URL })).toThrow(
      /DIRECT_URL is not set/
    );
    expect(() =>
      parseEnv(migrationEnvSchema, { DIRECT_URL: "", DATABASE_URL })
    ).toThrow(/DIRECT_URL is not set/);
  });

  it("only accepts a postgres URL", () => {
    expect(() =>
      parseEnv(migrationEnvSchema, { DIRECT_URL: "not a url" })
    ).toThrow(/must be a postgres:\/\/ .*\n.*at DIRECT_URL/);
  });
});
