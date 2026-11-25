import { type NextRequest, NextResponse } from "next/server";

import { isListedCompetitionSlug } from "@/app/competitions/_lib/view";
import type { SlugLookup } from "@/app/competitions/_lib/slug-lookup";
import {
  CERTIFICATE_VERIFY_PREFIX,
  CONSENT_LINK_PREFIX,
  DONATION_CHECKOUT_PREFIX,
  individualRegisterSlug,
  isConsentLinkPage,
  isDonationCheckoutPage,
  isNonProductionPath,
  isSignedInPage,
  JUDGE_INVITATIONS_PREFIX,
  isJudgeInvitationPage,
  isSignedInPath,
  isUnderPrefix,
} from "@/lib/app-routes";
import { createNonce, publicCsp, signedInCsp } from "@/lib/csp";
import { cspContext } from "@/lib/csp-sources";
import { ROUTES } from "@/lib/routes";
import { signInNext } from "@/lib/sign-in-next";
import { PATH_HEADER } from "@/lib/second-factor-routes";
import { appEnv } from "@/lib/site";
import { hasSessionCookie } from "@/server/identity/session-cookie";
import { checkPostSlug } from "@/server/modules/cms/domain/post-slug";
import { parseLotCode } from "@/server/modules/auctions/domain/lot-code";
import { ADOPTION_SLUG_PATTERN } from "@/server/modules/adoption/domain/slug";
import { isListingSlug } from "@/server/modules/directory/domain/slug";

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
 * Lets a request through under a fresh nonce policy (#65). Next
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
  headers.delete(PATH_HEADER);
  if (isSignedInPath(request.nextUrl.pathname)) {
    headers.set(PATH_HEADER, request.nextUrl.pathname + request.nextUrl.search);
  }
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
  /**
   * Whether a verified directory listing (#127) has this slug: the
   * directory, through a memo (src/app/ngos/_lib/public-slugs.ts). Without
   * one, every listing slug is the 404.
   */
  isPublicListingSlug?: SlugLookup;
  /**
   * Whether an adoptable animal (#129) has a public page at this slug:
   * the adoption module, through a memo (src/app/adopt/_lib/public-slugs.ts).
   * Without one, every animal slug is the 404.
   */
  isAdoptableSlug?: SlugLookup;
  /** Fresh auction visibility check; never cache consent across requests. */
  isPublicAuctionLot?: SlugLookup;
};

export type RequestProxy = (request: NextRequest) => Promise<NextResponse>;

export function createProxy({
  isPublishedCompetitionSlug,
  isPublicPostSlug,
  isPublicListingSlug = async () => false,
  isAdoptableSlug = async () => false,
  isPublicAuctionLot = async () => false,
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

  /**
   * Whether /ngos/<raw> is a verified listing: not pending, rejected,
   * suspended, withdrawn or unknown. A slug no listing could have is never
   * asked about. If the database can't answer, the request goes through
   * and the page answers for itself.
   */
  async function isPublicListing(raw: string): Promise<boolean> {
    const slug = decodedSlug(raw);
    if (!isListingSlug(slug)) return false;
    try {
      return await isPublicListingSlug(slug);
    } catch (error) {
      console.error(
        "Proxy: could not check a listing slug against the database.",
        error instanceof Error ? error.message : error
      );
      return true;
    }
  }

  /**
   * Whether /adopt/<raw> has a public page: published, on hold or adopted,
   * under a verified directory listing. If the database can't answer, the
   * request goes through and the page answers for itself.
   */
  async function isAdoptable(raw: string): Promise<boolean> {
    const slug = decodedSlug(raw);
    // /adopt/stories is a page of its own (#130); no animal's slug is a
    // single word, so none can take it.
    if (slug === "stories") return true;
    if (!ADOPTION_SLUG_PATTERN.test(slug)) return false;
    try {
      return await isAdoptableSlug(slug);
    } catch (error) {
      console.error(
        "Proxy: could not check an adoption slug against the database.",
        error instanceof Error ? error.message : error
      );
      return true;
    }
  }

  async function isAuctionLot(raw: string): Promise<boolean> {
    const code = parseLotCode(decodedSlug(raw));
    if (!code) return false;
    try {
      return await isPublicAuctionLot(code);
    } catch {
      console.error("Proxy: could not verify auction lot visibility.");
      return false;
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
    // Public certificate verification needs a full response even without JS.
    if (isUnderPrefix(pathname, [CERTIFICATE_VERIFY_PREFIX]))
      return withNonceCsp(request);
    // Bearer links use the nonce policy and render without sign-in.
    if (isUnderPrefix(pathname, [CONSENT_LINK_PREFIX])) {
      return isConsentLinkPage(pathname)
        ? withNonceCsp(request)
        : missingSignedInPage(request);
    }
    if (isUnderPrefix(pathname, [JUDGE_INVITATIONS_PREFIX])) {
      return isJudgeInvitationPage(pathname)
        ? withNonceCsp(request)
        : missingSignedInPage(request);
    }
    // A donation's checkout (#106) is a bearer page too: the nonce policy,
    // which carries Razorpay's origins, for anyone signed in or not.
    if (isUnderPrefix(pathname, [DONATION_CHECKOUT_PREFIX])) {
      return isDonationCheckoutPage(pathname)
        ? withNonceCsp(request)
        : missingSignedInPage(request);
    }
    // Pages behind sign-in: a request without a session cookie goes
    // straight to sign in. With one, the page checks the session itself.
    if (isSignedInPath(pathname)) {
      if (!hasSessionCookie(request.headers)) {
        const signIn = new URL(ROUTES.signIn.path, request.url);
        // A winning offer link must return the authenticated buyer to the
        // exact private checkout, not the generic account dashboard.
        if (pathname.startsWith("/account/auctions")) {
          const next = signInNext(pathname);
          if (next) signIn.searchParams.set("next", next);
        }
        return NextResponse.redirect(signIn);
      }
      if (!isSignedInPage(pathname)) return missingSignedInPage(request);
      // The individual register form names a public competition (#78):
      // an unknown or draft one gets the 404 status here, before the
      // page's notFound() could only stream a 200.
      const competition = individualRegisterSlug(pathname);
      if (
        competition !== null &&
        !(await isPublishedCompetition(competition))
      ) {
        return missingSignedInPage(request);
      }
      return withNonceCsp(request);
    }

    const [, section, raw = ""] = pathname.split("/");
    const known =
      section === "blog"
        ? await isPublicPost(raw)
        : section === "ngos"
          ? await isPublicListing(raw)
          : section === "adopt"
            ? await isAdoptable(raw)
            : section === "auctions"
              ? await isAuctionLot(raw)
              : await isPublishedCompetition(raw);
    if (known) return NextResponse.next();
    return NextResponse.rewrite(new URL(MISSING, request.url));
  };
}
