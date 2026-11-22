import { type NextRequest, NextResponse } from "next/server";

import { isListedCompetitionSlug } from "@/app/competitions/_lib/view";
import type { SlugLookup } from "@/app/competitions/_lib/slug-lookup";
import {
  isNonProductionPath,
  isSignedInPage,
  isSignedInPath,
} from "@/lib/app-routes";
import { createNonce, publicCsp, signedInCsp } from "@/lib/csp";
import { cspContext } from "@/lib/csp-sources";
import { ROUTES } from "@/lib/routes";
import { PATH_HEADER } from "@/lib/second-factor-routes";
import { appEnv } from "@/lib/site";
import { hasSessionCookie } from "@/server/identity/session-cookie";
import { checkPostSlug } from "@/server/modules/cms/domain/post-slug";

// What src/proxy.ts runs on each request it matches. It's built from its
// outside dependencies, the published-competition and public-post checks,
// so tests can give it stand-ins for the database.

// No route matches this path, so Next serves app/not-found.tsx with a 404.
const MISSING = "/__not-found";

/** The decoded path segment; a malformed escape can't be a real slug. */
function decodedSlug(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}

/**
 * Lets a signed-in request through under a fresh nonce policy (#65). Next
 * reads the nonce from the policy on the page's request headers and puts
 * it on every script it renders; the browser gets the same policy. Public
 * pages get theirs from next.config.ts headers().
 */
function withNonceCsp(request: NextRequest): NextResponse {
  const nonce = createNonce();
  const policy = signedInCsp(cspContext(), nonce, request.nextUrl.pathname);
  const headers = new Headers(request.headers);
  // Next reads an enforced policy before a report-only one: drop any the
  // client sent, so only this request's nonce reaches the page.
  headers.delete("content-security-policy");
  headers.delete("content-security-policy-report-only");
  headers.set(policy.key, policy.value);
  headers.set("x-nonce", nonce);
  // The page's path, so the staff gate (#60) can send the user back to it;
  // set here, so one the browser sent never reaches the page.
  headers.set(PATH_HEADER, request.nextUrl.pathname + request.nextUrl.search);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(policy.key, policy.value);
  return response;
}

/**
 * The prerendered 404 for a path under the signed-in tree that has no page.
 * Its scripts have no nonce, so it gets the public policy, which
 * next.config.ts headers() leaves out of this tree. (A notFound() under the
 * signed-in layout runs after the response has started, so it can only
 * stream a 200.)
 */
function missingSignedInPage(request: NextRequest): NextResponse {
  const policy = publicCsp(cspContext());
  const response = NextResponse.rewrite(new URL(MISSING, request.url));
  response.headers.set(policy.key, policy.value);
  return response;
}

export type RequestProxyDeps = {
  /**
   * Whether a published competition has this slug: the database, through
   * a memo (src/app/competitions/_lib/public-reader.ts).
   */
  isPublishedCompetitionSlug: SlugLookup;
  /**
   * Whether a public post (#112) has this slug: the CMS, through a memo
   * (src/app/blog/_lib/public-slugs.ts).
   */
  isPublicPostSlug: SlugLookup;
};

export type RequestProxy = (request: NextRequest) => Promise<NextResponse>;

export function createProxy({
  isPublishedCompetitionSlug,
  isPublicPostSlug,
}: RequestProxyDeps): RequestProxy {
  /**
   * Whether /competitions/<raw> is published. If the database can't
   * answer, the request goes through: the page then reports the failure
   * itself, rather than every competition looking deleted.
   */
  async function isPublishedCompetition(raw: string): Promise<boolean> {
    try {
      return await isListedCompetitionSlug(raw, isPublishedCompetitionSlug);
    } catch (error) {
      console.error(
        "Proxy: could not check a competition slug against the database.",
        error instanceof Error ? error.message : error
      );
      return true;
    }
  }

  /**
   * Whether /blog/<raw> is a public post: not a draft, archived or unknown.
   * A slug no post could have is never asked about. If the database can't
   * answer, the request goes through and the page answers for itself.
   */
  async function isPublicPost(raw: string): Promise<boolean> {
    const slug = decodedSlug(raw);
    if (!checkPostSlug(slug).ok) return false;
    try {
      return await isPublicPostSlug(slug);
    } catch (error) {
      console.error(
        "Proxy: could not check a post slug against the database.",
        error instanceof Error ? error.message : error
      );
      return true;
    }
  }

  // Unlisted slugs render at request time, and the header's <Suspense>
  // starts streaming before the page's notFound() runs, so they would keep
  // a 200 status (cacheComponents rules out dynamicParams = false).
  // Rejecting them here, before rendering starts, gives a real 404.
  return async function proxy(request) {
    const { pathname } = request.nextUrl;
    // Demo pages don't exist in production: the 404 for everyone, visitors
    // included, before the sign-in check.
    if (appEnv() === "production" && isNonProductionPath(pathname)) {
      return missingSignedInPage(request);
    }
    // Pages behind sign-in: a request without a session cookie goes
    // straight to sign in. With one, the page checks the session itself.
    if (isSignedInPath(pathname)) {
      if (!hasSessionCookie(request.headers)) {
        return NextResponse.redirect(new URL(ROUTES.signIn.path, request.url));
      }
      return isSignedInPage(pathname)
        ? withNonceCsp(request)
        : missingSignedInPage(request);
    }

    const [, section, raw = ""] = pathname.split("/");
    const known =
      section === "blog"
        ? await isPublicPost(raw)
        : await isPublishedCompetition(raw);
    if (known) return NextResponse.next();
    return NextResponse.rewrite(new URL(MISSING, request.url));
  };
}
