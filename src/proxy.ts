import type { NextRequest, NextResponse } from "next/server";

import { publicAuctionLot } from "@/app/auctions/_lib/public-lot";
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
  isPublicAuctionLot: publicAuctionLot,
});

export function proxy(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}

export const config = {
  matcher: [
    "/verify",
    "/verify/:path*",
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
    "/auctions/:lotCode",
    "/ngos/register/:path*",
    "/judge",
    "/judge/:path*",
    "/organisation",
    "/organisation/:path*",
    "/consent/:path*",
    "/donate/checkout/:path*",
  ],
};
