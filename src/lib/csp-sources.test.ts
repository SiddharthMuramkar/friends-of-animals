import { describe, expect, it } from "vitest";

import { publicCsp, signedInCsp } from "./csp";
import { cspContext } from "./csp-sources";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const R2_ORIGIN = `https://${ACCOUNT}.r2.cloudflarestorage.com`;

function directive(value: string, name: string): string[] {
  const part = value
    .split(";")
    .map((each) => each.trim())
    .find((each) => each.startsWith(`${name} `));
  return part ? part.split(/\s+/).slice(1) : [];
}

describe("cspContext: file storage", () => {
  it("lets pages PUT to and show images from the configured R2 account", () => {
    const context = cspContext({
      APP_ENV: "preview",
      NODE_ENV: "production",
      R2_ACCOUNT_ID: ACCOUNT,
    });

    for (const header of [
      publicCsp(context),
      signedInCsp(context, "bm9uY2U="),
    ]) {
      expect(directive(header.value, "connect-src")).toContain(R2_ORIGIN);
      // <img src="/api/files/…"> follows a redirect to the bucket.
      expect(directive(header.value, "img-src")).toContain(R2_ORIGIN);
      expect(directive(header.value, "default-src")).toEqual(["'self'"]);
    }
  });

  it("adds no storage origin while R2 isn't configured", () => {
    const header = publicCsp(
      cspContext({ APP_ENV: "preview", NODE_ENV: "production" })
    );

    expect(header.value).not.toContain("r2.cloudflarestorage.com");
  });

  it("ignores an account id that isn't one, rather than break every page", () => {
    for (const R2_ACCOUNT_ID of [
      "evil.example.com",
      "x y",
      ACCOUNT.toUpperCase(),
    ]) {
      const header = publicCsp(
        cspContext({
          APP_ENV: "preview",
          NODE_ENV: "production",
          R2_ACCOUNT_ID,
        })
      );
      expect(header.value).not.toContain("cloudflarestorage");
      expect(header.value).not.toContain("evil.example.com");
    }
  });
});
