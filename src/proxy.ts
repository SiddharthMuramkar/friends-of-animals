import type { NextRequest, NextResponse } from "next/server";

import { adoptableSlugLookup } from "@/app/adopt/_lib/public-slugs";
import { publicPostSlugLookup } from "@/app/blog/_lib/public-slugs";
import { publishedSlugLookup } from "@/app/competitions/_lib/public-reader";
import { publicListingSlugLookup } from "@/app/ngos/_lib/public-slugs";
import { createProxy } from "@/request-proxy";

// The logic lives in src/request-proxy.ts; this file wires it to the
// database and tells Next which paths it runs on.
const handle = createProxy({
  isPublishedCompetitionSlug: publishedSlugLookup,
  isPublicPostSlug: publicPostSlugLookup,
  isPublicListingSlug: publicListingSlugLookup,
  isAdoptableSlug: adoptableSlugLookup,
});

export function proxy(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}

export const config = {
  matcher: [
    "/blog/:slug",
    "/competitions/:slug",
    "/account",
    "/account/:path*",
    "/admin",
    "/admin/:path*",
    "/auth",
    "/auth/:path*",
    "/dashboard",
    "/dashboard/:path*",
    "/institution",
    "/institution/:path*",
    "/institutions/register",
    "/institutions/register/:path*",
    "/participant",
    "/participant/:path*",
    "/guardian",
    "/guardian/:path*",
    "/ngos/:slug",
    "/adopt/:slug",
    "/ngos/register/:path*",
    "/organisation",
    "/organisation/:path*",
    "/consent/:path*",
  ],
};
