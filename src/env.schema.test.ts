import { describe, expect, it } from "vitest";
import { z } from "zod";

import { envSchema, parseEnv } from "./env.schema";

const DATABASE_URL = "postgres://foa:foa@localhost:5432/foa";

describe("parseEnv", () => {
  it("applies defaults and needs no database at parse time", () => {
    const config = parseEnv(envSchema, {});
    expect(config.NODE_ENV).toBe("development");
    expect(config.APP_ENV).toBe("local");
    expect(config.DATABASE_URL).toBeUndefined();
    expect(config.DIRECT_URL).toBeUndefined();
  });

  it("treats empty strings as unset", () => {
    const config = parseEnv(envSchema, { DATABASE_URL: "", APP_ENV: "" });
    expect(config.DATABASE_URL).toBeUndefined();
    expect(config.APP_ENV).toBe("local");
  });

  it("drops variables the schema doesn't name", () => {
    expect(parseEnv(envSchema, { HOME: "/root" })).not.toHaveProperty("HOME");
  });

  it("lists every invalid variable in one error", () => {
    const schema = z.object({ A: z.string(), B: z.string() });
    expect(() => parseEnv(schema, {})).toThrow(
      /^Invalid environment configuration:\n[\s\S]*\bA\b[\s\S]*\bB\b/
    );
  });
});

describe("envSchema", () => {
  it("accepts every APP_ENV and rejects anything else", () => {
    for (const appEnv of ["local", "preview", "staging", "production"]) {
      expect(parseEnv(envSchema, { APP_ENV: appEnv }).APP_ENV).toBe(appEnv);
    }
    expect(() => parseEnv(envSchema, { APP_ENV: "prod" })).toThrow(/APP_ENV/);
  });

  it("only accepts postgres URLs for DATABASE_URL and DIRECT_URL", () => {
    expect(parseEnv(envSchema, { DATABASE_URL }).DATABASE_URL).toBe(
      DATABASE_URL
    );
    expect(
      parseEnv(envSchema, {
        DIRECT_URL: "postgresql://m:p@db.example.org:6432/foa",
      }).DIRECT_URL
    ).toBe("postgresql://m:p@db.example.org:6432/foa");
    expect(() =>
      parseEnv(envSchema, { DATABASE_URL: "mysql://localhost/foa" })
    ).toThrow(/DATABASE_URL/);
    expect(() => parseEnv(envSchema, { DIRECT_URL: "not a url" })).toThrow(
      /DIRECT_URL/
    );
  });

  it("requires APP_URL to be an http(s) URL", () => {
    expect(() => parseEnv(envSchema, { APP_URL: "example.org" })).toThrow(
      /APP_URL/
    );
    expect(
      parseEnv(envSchema, { APP_URL: "https://foa.shipped-it.dev" }).APP_URL
    ).toBe("https://foa.shipped-it.dev");
  });
});
