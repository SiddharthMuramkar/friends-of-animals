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

describe("cspContext: Razorpay Checkout", () => {
  const PAY = "/institution/registrations/NEIGH27-I-5EED1/pay";
  const KEYS = { RAZORPAY_KEY_ID: "rzp_test_1DP5mmOlF5G5ag" };

  it("lets the pay page alone load, frame and call Checkout while Razorpay keys are set", () => {
    const context = cspContext({
      APP_ENV: "staging",
      NODE_ENV: "production",
      ...KEYS,
    });

    const pay = signedInCsp(context, "bm9uY2U=", PAY).value;
    expect(directive(pay, "script-src")).toContain(
      "https://checkout.razorpay.com"
    );
    expect(directive(pay, "frame-src")).toEqual(["https://api.razorpay.com"]);
    expect(directive(pay, "connect-src")).toEqual([
      "'self'",
      "https://api.razorpay.com",
      "https://lumberjack.razorpay.com",
    ]);
    expect(directive(pay, "img-src")).toContain("https://cdn.razorpay.com");
    // The nonce still decides which scripts run.
    expect(directive(pay, "script-src")).toContain("'strict-dynamic'");

    for (const header of [
      signedInCsp(
        context,
        "bm9uY2U=",
        "/institution/registrations/NEIGH27-I-5EED1"
      ),
      signedInCsp(context, "bm9uY2U=", "/account/sessions"),
      publicCsp(context),
    ]) {
      expect(header.value).not.toContain("razorpay");
    }
  });

  it("adds nothing while no Razorpay keys are set: the fallback's test checkout is on our own origin", () => {
    const context = cspContext({ APP_ENV: "local", NODE_ENV: "production" });

    expect(signedInCsp(context, "bm9uY2U=", PAY).value).not.toContain(
      "razorpay"
    );
  });
});
