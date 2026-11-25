import { getScriptNonceFromHeader } from "next/dist/server/app-render/get-script-nonce-from-header";
import {
  getRewrittenUrl,
  unstable_doesMiddlewareMatch,
} from "next/experimental/testing/server";
import { NextRequest, type NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { individualLink } from "@/app/participate/_lib/individual-link";
import { ADMIN_HOME, APP_ROUTES, SIGNED_IN_PREFIXES } from "@/lib/app-routes";
import { publicCsp } from "@/lib/csp";
import { PATH_HEADER } from "@/lib/second-factor-routes";
import { cspContext } from "@/lib/csp-sources";
import { createProxy } from "@/request-proxy";

import { config } from "./proxy";

// Competition and post slugs are checked against the database (#70,
// #112); here no competition is published and one story is.
// src/proxy.competitions.test.ts and src/proxy.blog.test.ts cover them.
const proxy = createProxy({
  isPublishedCompetitionSlug: async () => false,
  isPublicPostSlug: async (slug) => slug === "kinder-skies-in-kite-season",
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const SESSION = { cookie: "foa.session_token=token.signature" };

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://foa.example.test${path}`, { headers });
}

/**
 * The request headers the page renders with, as the proxy forwards them
 * (next/dist/server/web/spec-extension/response.js), or undefined if it
 * forwards the request unchanged.
 */
function forwarded(response: NextResponse): Headers | undefined {
  const keys = response.headers.get("x-middleware-override-headers");
  if (keys === null) return undefined;
  const headers = new Headers();
  for (const key of keys.split(",")) {
    headers.set(key, response.headers.get(`x-middleware-request-${key}`)!);
  }
  return headers;
}

/** The forwarded request headers of a response that must forward some. */
function pageHeaders(response: NextResponse): Headers {
  const headers = forwarded(response);
  expect(headers, "request headers forwarded to the page").toBeDefined();
  return headers!;
}

const POLICY_KEYS = [
  "content-security-policy",
  "content-security-policy-report-only",
];

describe("proxy: the signed-in nonce policy", () => {
  it("sends a signed-in page the nonce policy, and renders it with the same nonce", async () => {
    vi.stubEnv("APP_ENV", "preview");
    const response = await proxy(request("/account/sessions", SESSION));

    const policy = response.headers.get("content-security-policy");
    expect(policy, "the response's policy").toEqual(expect.any(String));
    expect(policy).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    const nonce = getScriptNonceFromHeader(policy!);
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);

    const page = pageHeaders(response);
    expect(page.get("content-security-policy")).toBe(policy);
    expect(page.get("x-nonce")).toBe(nonce);
    // The session cookie still reaches the page.
    expect(page.get("cookie")).toBe(SESSION.cookie);
  });

  it("adds a nonce to a public bearer page without forwarding a return path", async () => {
    vi.stubEnv("APP_ENV", "local");
    const path = "/consent/synthetic-token";
    expect(
      unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: path })
    ).toBe(true);
    const response = await proxy(request(path, { [PATH_HEADER]: path }));
    const policy = response.headers.get("content-security-policy");
    expect(response.headers.has("location")).toBe(false);
    expect(getScriptNonceFromHeader(policy ?? "")).toBe(
      pageHeaders(response).get("x-nonce")
    );
    expect(policy).toContain("'strict-dynamic'");
    expect(pageHeaders(response).has(PATH_HEADER)).toBe(false);
  });

  it("renders public certificate verification with request nonces but no session", async () => {
    vi.stubEnv("APP_ENV", "local");
    for (const path of ["/verify", "/verify/FOA-C-27-9XQ4M2T7KD"]) {
      expect(
        unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: path })
      ).toBe(true);
      const response = await proxy(request(path));
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      const nonce = pageHeaders(response).get("x-nonce");
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(response.headers.get("content-security-policy")).toContain(
        `nonce-${nonce}`
      );
      expect(pageHeaders(response).has(PATH_HEADER)).toBe(false);
    }
  });

  it("makes a fresh nonce for every request", async () => {
    const nonces = new Set(
      await Promise.all(
        Array.from({ length: 5 }, async () => {
          const response = await proxy(request("/account/sessions", SESSION));
          return pageHeaders(response).get("x-nonce");
        })
      )
    );
    expect(nonces.size).toBe(5);
  });

  it("only reports on staging and production, and Next still reads the nonce", async () => {
    for (const appEnv of ["staging", "production"]) {
      vi.stubEnv("APP_ENV", appEnv);
      const response = await proxy(request("/account/sessions", SESSION));

      expect(response.headers.get("content-security-policy")).toBeNull();
      const policy = response.headers.get(
        "content-security-policy-report-only"
      );
      const page = pageHeaders(response);
      expect(page.get("content-security-policy-report-only")).toBe(policy);
      expect(getScriptNonceFromHeader(policy!)).toBe(page.get("x-nonce"));
    }
  });

  it("replaces any policy or nonce the client sent", async () => {
    vi.stubEnv("APP_ENV", "staging");
    const response = await proxy(
      request("/account/sessions", {
        ...SESSION,
        "content-security-policy": "script-src 'nonce-chosenbyclient'",
        "x-nonce": "chosenbyclient",
      })
    );

    const page = pageHeaders(response);
    expect(page.get("content-security-policy")).toBeNull();
    expect(page.get("content-security-policy-report-only")).not.toContain(
      "chosenbyclient"
    );
    expect(page.get("x-nonce")).not.toBe("chosenbyclient");
  });

  it("lets each contact message's page through under the nonce policy", async () => {
    vi.stubEnv("APP_ENV", "preview");
    const response = await proxy(
      request("/admin/inbox/01938a00-0000-7000-8113-000000000001", SESSION)
    );

    expect(getRewrittenUrl(response)).toBeNull();
    expect(pageHeaders(response).get("x-nonce")).toEqual(expect.any(String));
  });

  it("answers any other signed-in path with the static 404 under the public policy", async () => {
    vi.stubEnv("APP_ENV", "preview");
    // A request-time notFound() under the signed-in layout could only stream
    // a 200; the prerendered 404 has no nonce on its scripts.
    for (const path of [
      "/account",
      "/account/nope",
      "/account/sessions/x",
      "/admin/competitions/x",
      "/admin/competitions/x/delete",
      "/admin/competitions/x/edit/more",
      "/admin/competitions//edit",
    ]) {
      const response = await proxy(request(path, SESSION));

      expect(getRewrittenUrl(response), path).toBe(
        "https://foa.example.test/__not-found"
      );
      expect(response.headers.get("content-security-policy"), path).toBe(
        publicCsp(cspContext()).value
      );
      expect(forwarded(response), path).toBeUndefined();
    }
  });

  it("serves a template's editor, a page with a dynamic segment, but no deeper path (#69)", async () => {
    vi.stubEnv("APP_ENV", "preview");
    const editor = await proxy(
      request("/admin/templates/identity.welcome", SESSION)
    );

    expect(pageHeaders(editor).get("x-nonce")).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    for (const path of [
      "/admin/templates/identity.welcome/x",
      "/admin/templates/",
    ]) {
      expect(getRewrittenUrl(await proxy(request(path, SESSION))), path).toBe(
        "https://foa.example.test/__not-found"
      );
    }
  });

  it("sends a competition's edit and preview pages the nonce policy too", async () => {
    vi.stubEnv("APP_ENV", "preview");
    for (const page of ["edit", "preview"]) {
      const path = `/admin/competitions/01938a00-0000-7000-8000-000000002001/${page}`;
      const response = await proxy(request(path, SESSION));

      expect(getRewrittenUrl(response), path).toBeNull();
      const policy = response.headers.get("content-security-policy");
      expect(policy, path).toMatch(/script-src 'self' 'nonce-[^']+'/);
      expect(pageHeaders(response).get("x-nonce"), path).toBe(
        getScriptNonceFromHeader(policy!)
      );
    }
  });

  it("serves an institution review page with the signed-in nonce", async () => {
    vi.stubEnv("APP_ENV", "preview");
    const path = "/admin/institutions/01938a00-0000-7000-8000-000000001001";

    expect(
      pageHeaders(await proxy(request(path, SESSION))).get("x-nonce")
    ).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(
      getRewrittenUrl(await proxy(request(`${path}/extra`, SESSION)))
    ).toBe("https://foa.example.test/__not-found");
  });

  it("still sends a visitor with no session cookie to sign in", async () => {
    const response = await proxy(request("/account/sessions"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://foa.example.test/sign-in"
    );
  });

  describe("on the staff admin pages", () => {
    it("sends a page the nonce policy, and renders it with the same nonce", async () => {
      vi.stubEnv("APP_ENV", "preview");
      const response = await proxy(
        request(APP_ROUTES.adminConsentDocuments, SESSION)
      );

      const policy = response.headers.get("content-security-policy");
      expect(policy).toMatch(
        /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/
      );
      expect(policy).not.toMatch(/script-src [^;]*'unsafe-inline'/);
      const page = pageHeaders(response);
      expect(page.get("content-security-policy")).toBe(policy);
      expect(page.get("x-nonce")).toBe(getScriptNonceFromHeader(policy!));
    });

    it("sends a visitor with no session cookie to sign in", async () => {
      const response = await proxy(request(APP_ROUTES.adminConsentDocuments));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "https://foa.example.test/sign-in"
      );
    });

    it("serves the new admin home with the staff nonce and requires a session", async () => {
      vi.stubEnv("APP_ENV", "preview");
      const response = await proxy(request(ADMIN_HOME, SESSION));
      expect(getRewrittenUrl(response)).toBeNull();
      const policy = response.headers.get("content-security-policy");
      expect(policy).toMatch(/script-src 'self' 'nonce-[^']+'/);
      expect(pageHeaders(response).get("x-nonce")).toBe(
        getScriptNonceFromHeader(policy!)
      );
      const guest = await proxy(request(ADMIN_HOME));
      expect(guest.status).toBe(307);
      expect(guest.headers.get("location")).toBe(
        "https://foa.example.test/sign-in"
      );
    });

    it("answers a path with no page with the static 404", async () => {
      vi.stubEnv("APP_ENV", "preview");
      for (const path of ["/admin/nope", "/admin/home/nope"]) {
        const response = await proxy(request(path, SESSION));

        expect(getRewrittenUrl(response), path).toBe(
          "https://foa.example.test/__not-found"
        );
        expect(response.headers.get("content-security-policy"), path).toBe(
          publicCsp(cspContext()).value
        );
      }
    });
  });

  it("adds Razorpay Checkout's origins to the pay page's policy alone, once keys are set", async () => {
    vi.stubEnv("APP_ENV", "preview");
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_1DP5mmOlF5G5ag");

    const pay = await proxy(
      request("/institution/registrations/NEIGH27-I-5EED1/pay", SESSION)
    );
    const students = await proxy(
      request("/institution/registrations/NEIGH27-I-5EED1", SESSION)
    );

    expect(pay.headers.get("content-security-policy")).toMatch(
      /frame-src https:\/\/api\.razorpay\.com/
    );
    expect(pageHeaders(pay).get("content-security-policy")).toBe(
      pay.headers.get("content-security-policy")
    );
    expect(students.headers.get("content-security-policy")).not.toContain(
      "razorpay"
    );
  });

  it("serves a donation's checkout to a visitor under the nonce policy, with Razorpay's origins (#106)", async () => {
    vi.stubEnv("APP_ENV", "preview");
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_1DP5mmOlF5G5ag");
    const path = "/donate/checkout/0193a8f0-0000-7000-8000-000000000001";
    expect(
      unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: path })
    ).toBe(true);
    expect(
      unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/donate" })
    ).toBe(false);

    const checkout = await proxy(request(path));

    expect(checkout.headers.has("location")).toBe(false);
    const policy = checkout.headers.get("content-security-policy");
    expect(policy).toMatch(/frame-src https:\/\/api\.razorpay\.com/);
    expect(getScriptNonceFromHeader(policy ?? "")).toBe(
      pageHeaders(checkout).get("x-nonce")
    );
    const deeper = await proxy(request(`${path}/more`));
    expect(getRewrittenUrl(deeper)).toBe(
      "https://foa.example.test/__not-found"
    );
  });

  it("never runs on the payment gateway's webhook, so nothing sends it to sign in", () => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        url: "https://foa.example.test/api/webhooks/razorpay",
      })
    ).toBe(false);
  });

  it("leaves public pages to next.config.ts headers()", async () => {
    for (const path of [
      "/blog/kinder-skies-in-kite-season",
      "/blog/no-such-story",
      "/competitions/no-such-competition",
    ]) {
      const response = await proxy(request(path, SESSION));
      for (const key of POLICY_KEYS) {
        expect(response.headers.get(key), path).toBeNull();
        expect(forwarded(response)?.get(key) ?? null, path).toBeNull();
      }
    }
  });

  it("runs on every page in APP_ROUTES", () => {
    for (const path of Object.values(APP_ROUTES)) {
      const url = `https://foa.example.test${path}`;
      expect(unstable_doesMiddlewareMatch({ config, url }), path).toBe(true);
    }
  });

  it("runs on every path under SIGNED_IN_PREFIXES", () => {
    for (const prefix of SIGNED_IN_PREFIXES) {
      for (const path of [prefix, `${prefix}/sessions`, `${prefix}/a/b`]) {
        const url = `https://foa.example.test${path}`;
        expect(unstable_doesMiddlewareMatch({ config, url }), path).toBe(true);
      }
    }
  });
});

describe("proxy: the individual register form (#78)", () => {
  // The form takes a signed-in adult's date of birth, phone and address,
  // so it renders per request under the nonce policy, like the school
  // form; and an unknown or draft competition gets a real 404 before
  // anything streams (a notFound() inside the page could only send a 200).
  const proxy = createProxy({
    isPublishedCompetitionSlug: async (slug) =>
      slug === "neighbours-on-my-street",
    isPublicPostSlug: async () => false,
  });
  /** Where the chooser's "Register as an individual" button leads. */
  const form = (slug: string) => individualLink(slug).href;
  const MISSING = "https://foa.example.test/__not-found";

  it("runs on the form of any competition", () => {
    for (const slug of ["neighbours-on-my-street", "no-such-competition"]) {
      const url = `https://foa.example.test${form(slug)}`;
      expect(unstable_doesMiddlewareMatch({ config, url }), slug).toBe(true);
    }
  });

  it("sends a published competition's form the nonce policy, and renders it with the same nonce", async () => {
    vi.stubEnv("APP_ENV", "preview");
    const response = await proxy(
      request(form("neighbours-on-my-street"), SESSION)
    );

    expect(getRewrittenUrl(response)).toBeNull();
    const policy = response.headers.get("content-security-policy");
    expect(policy).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(policy).not.toMatch(/script-src [^;]*'unsafe-inline'/);
    expect(pageHeaders(response).get("x-nonce")).toBe(
      getScriptNonceFromHeader(policy!)
    );
  });

  it("answers the form of an unknown, draft or malformed competition with the static 404", async () => {
    vi.stubEnv("APP_ENV", "preview");
    for (const slug of ["no-such-competition", "a-draft", "%E0%A4%A"]) {
      const path = form("no-such-competition").replace(
        "no-such-competition",
        slug
      );
      const response = await proxy(request(path, SESSION));

      expect(getRewrittenUrl(response), path).toBe(MISSING);
      expect(response.headers.get("content-security-policy"), path).toBe(
        publicCsp(cspContext()).value
      );
      expect(forwarded(response), path).toBeUndefined();
    }
  });

  it("sends a visitor with no session cookie to sign in", async () => {
    const response = await proxy(request(form("neighbours-on-my-street")));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://foa.example.test/sign-in"
    );
  });
});

describe("proxy: the file upload demo", () => {
  it("is the 404, under the public policy, in production, signed in or not", async () => {
    vi.stubEnv("APP_ENV", "production");

    for (const headers of [{}, SESSION]) {
      const response = await proxy(request("/account/files", headers));

      expect(getRewrittenUrl(response)).toBe(
        "https://foa.example.test/__not-found"
      );
      // Production only reports, so the policy's own key names the header.
      const policy = publicCsp(cspContext());
      expect(response.headers.get(policy.key)).toBe(policy.value);
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it.each(["preview", "staging", "local"])(
    "is a signed-in page under APP_ENV=%s",
    async (name) => {
      vi.stubEnv("APP_ENV", name);

      expect(
        (await proxy(request("/account/files"))).headers.get("location")
      ).toBe("https://foa.example.test/sign-in");
      const page = pageHeaders(await proxy(request("/account/files", SESSION)));
      expect(page.get("x-nonce")).toEqual(expect.any(String));
    }
  );

  it("leaves the other account pages to the sign-in check in production", async () => {
    vi.stubEnv("APP_ENV", "production");

    expect(
      (await proxy(request("/account/sessions"))).headers.get("location")
    ).toBe("https://foa.example.test/sign-in");
  });
});

describe("proxy: the page's path, for the staff gate (#60)", () => {
  it.each([
    APP_ROUTES.accountSecurity,
    APP_ROUTES.secondFactor,
    APP_ROUTES.stepUp,
  ])(
    "sends a visitor without a session cookie from %s to sign in",
    async (path) => {
      const response = await proxy(request(path));
      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe(
        "/sign-in"
      );
    }
  );

  it("renders a signed-in page knowing its path and query, to come back to", async () => {
    vi.stubEnv("APP_ENV", "preview");
    const path = `${APP_ROUTES.stepUp}?next=%2Fadmin%2Froles`;

    expect(
      pageHeaders(await proxy(request(path, SESSION))).get(PATH_HEADER)
    ).toBe(path);
  });

  it("never passes on a path header the browser sent itself", async () => {
    vi.stubEnv("APP_ENV", "preview");
    const response = await proxy(
      request(APP_ROUTES.accountSecurity, {
        ...SESSION,
        [PATH_HEADER]: "https://example.com",
      })
    );

    expect(pageHeaders(response).get(PATH_HEADER)).toBe(
      APP_ROUTES.accountSecurity
    );
  });
});

describe("private auction checkout link", () => {
  it("carries only the exact local auction return through sign-in", async () => {
    const response = await proxy(request("/account/auctions/LOT-27-5EED5"));
    expect(response.headers.get("location")).toBe(
      "https://foa.example.test/sign-in?next=%2Faccount%2Fauctions%2FLOT-27-5EED5"
    );
    expect(
      (await proxy(request("/account/auctions/not-an-offer"))).headers.get(
        "location"
      )
    ).toBe("https://foa.example.test/sign-in");
    expect(
      pageHeaders(
        await proxy(request("/account/auctions/LOT-27-5EED5", SESSION))
      ).get("x-nonce")
    ).toEqual(expect.any(String));
  });
});

it("preloads only a freshly visible gallery stamp, with no cache or original URL", async () => {
  const id = "01938a00-0000-7000-8000-000000103001";
  let visible = true;
  const gallery = createProxy({
    isPublishedCompetitionSlug: async () => false,
    isPublicPostSlug: async () => false,
    isPublicGalleryItem: async (itemId) => visible && itemId === id,
  });
  const path = `/gallery/${id}`;
  expect(
    unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: path })
  ).toBe(true);
  const response = await gallery(request(path));
  expect(response.headers.get("Link")).toBe(
    `</media/gallery/${id}?size=thumb>; rel=preload; as=image; media="(max-width: 639px)"; fetchpriority=high, </media/gallery/${id}>; rel=preload; as=image; media="(min-width: 640px)"; fetchpriority=high`
  );
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  const list = await gallery(request("/gallery"));
  expect(list.headers.get("Link")).toBeNull();
  visible = false;
  const withdrawn = await gallery(request(path));
  expect(getRewrittenUrl(withdrawn)).toBe(
    "https://foa.example.test/__not-found"
  );
  expect(withdrawn.headers.get("Link")).toBeNull();
});
