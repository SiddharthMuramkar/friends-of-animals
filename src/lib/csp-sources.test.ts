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

describe("cspContext: public post images", () => {
  it("lets pages show images from the public bucket's domain, and nothing else from it", () => {
    const context = cspContext({
      APP_ENV: "production",
      NODE_ENV: "production",
      PUBLIC_ASSET_BASE_URL: "https://assets.friendsofanimals.dev/media/",
    });

    for (const header of [
      publicCsp(context),
      signedInCsp(context, "bm9uY2U="),
    ]) {
      expect(directive(header.value, "img-src")).toContain(
        "https://assets.friendsofanimals.dev"
      );
      expect(directive(header.value, "connect-src")).not.toContain(
        "https://assets.friendsofanimals.dev"
      );
    }
  });

  it("adds nothing for a value that isn't an https URL", () => {
    for (const PUBLIC_ASSET_BASE_URL of [
      "",
      "assets.example",
      "http://assets.example",
      "javascript:alert(1)",
    ]) {
      const header = publicCsp(
        cspContext({
          APP_ENV: "production",
          NODE_ENV: "production",
          PUBLIC_ASSET_BASE_URL,
        })
      );
      expect(header.value, PUBLIC_ASSET_BASE_URL).not.toContain(
        "assets.example"
      );
      expect(header.value).not.toContain("javascript");
    }
  });
});
